//! PostgreSQL engine: connection, catalog introspection, query execution and the
//! `.sql` backup dump. All SQL here is PostgreSQL-dialect (`pg_catalog`).

use std::{
    collections::BTreeMap,
    sync::Arc,
    time::{Duration, Instant},
};

use postgres_native_tls::MakeTlsConnector;
use tokio::time::timeout;
use tokio_postgres::{
    config::SslMode,
    types::{Kind, Type},
    Client, Config, NoTls, SimpleQueryMessage,
};

use super::types::{
    emit_backup_progress, parse_object_id, AppError, ColumnDefinition, ConnectionProfile,
    DatabaseObjectDetails, DatabaseObjectKind, DatabaseTreeNode, IndexDefinition, QueryExecution,
    SslModeDraft,
};
use super::CatalogObject;

impl From<tokio_postgres::Error> for AppError {
    fn from(error: tokio_postgres::Error) -> Self {
        AppError::Driver(format_postgres_error(&error))
    }
}

impl From<native_tls::Error> for AppError {
    fn from(error: native_tls::Error) -> Self {
        AppError::Driver(format!("PostgreSQL TLS error: {error}"))
    }
}

/// `tokio_postgres::Error`'s `Display` is just a generic "db error"; the useful
/// message (and optional detail/hint) lives in the underlying `DbError`.
fn format_postgres_error(error: &tokio_postgres::Error) -> String {
    let Some(db) = error.as_db_error() else {
        return format!("PostgreSQL error: {error}");
    };

    let mut message = format!("PostgreSQL error: {}", db.message());
    if let Some(detail) = db.detail() {
        message.push_str(&format!("\nDetail: {detail}"));
    }
    if let Some(hint) = db.hint() {
        message.push_str(&format!("\nHint: {hint}"));
    }
    message
}

/// Resolved PostgreSQL connection parameters.
pub struct PgConfig {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub user: String,
    pub password: String,
    pub ssl_mode: SslModeDraft,
}

pub async fn open(cfg: &PgConfig) -> Result<Arc<Client>, AppError> {
    let mut config = Config::new();
    config
        .host(&cfg.host)
        .port(cfg.port)
        .dbname(&cfg.database)
        .user(&cfg.user)
        .password(&cfg.password)
        .connect_timeout(Duration::from_secs(8));

    let client = match cfg.ssl_mode {
        SslModeDraft::Disable => connect_without_tls(config).await?,
        SslModeDraft::Prefer => connect_with_tls(config, SslMode::Prefer).await?,
        SslModeDraft::Require => connect_with_tls(config, SslMode::Require).await?,
    };

    Ok(Arc::new(client))
}

async fn connect_without_tls(mut config: Config) -> Result<Client, AppError> {
    config.ssl_mode(SslMode::Disable);
    let (client, connection) = timeout(Duration::from_secs(10), config.connect(NoTls))
        .await
        .map_err(|_| AppError::Timeout)?
        .map_err(|error| AppError::Connection(error.to_string()))?;

    tauri::async_runtime::spawn(async move {
        if let Err(error) = connection.await {
            eprintln!("PostgreSQL connection task ended: {error}");
        }
    });

    Ok(client)
}

async fn connect_with_tls(mut config: Config, ssl_mode: SslMode) -> Result<Client, AppError> {
    config.ssl_mode(ssl_mode);
    let connector = native_tls::TlsConnector::builder().build()?;
    let connector = MakeTlsConnector::new(connector);
    let (client, connection) = timeout(Duration::from_secs(10), config.connect(connector))
        .await
        .map_err(|_| AppError::Timeout)?
        .map_err(|error| AppError::Connection(error.to_string()))?;

    tauri::async_runtime::spawn(async move {
        if let Err(error) = connection.await {
            eprintln!("PostgreSQL TLS connection task ended: {error}");
        }
    });

    Ok(client)
}

pub async fn version(client: &Client) -> Result<String, AppError> {
    let row = client
        .query_one("select current_setting('server_version')", &[])
        .await?;
    Ok(row.get::<_, String>(0))
}

pub async fn list_tree(
    client: &Client,
    profile: &ConnectionProfile,
) -> Result<Vec<DatabaseTreeNode>, AppError> {
    let host = &profile.host;
    let port = profile.port;
    let database_name = &profile.database;
    let rows = client
        .query(
            "
            select
              n.nspname as schema_name,
              c.relname as object_name,
              case when c.relkind in ('v', 'm') then 'view' else 'table' end as object_kind
            from pg_catalog.pg_class c
            join pg_catalog.pg_namespace n on n.oid = c.relnamespace
            where c.relkind in ('r', 'p', 'v', 'm')
              and n.nspname not in ('pg_catalog', 'information_schema')
              and n.nspname not like 'pg_toast%'
              and n.nspname not like 'pg_temp_%'
            order by n.nspname, object_kind, c.relname
            ",
            &[],
        )
        .await?;

    let mut schemas: BTreeMap<String, Vec<DatabaseTreeNode>> = BTreeMap::new();
    for row in rows {
        let schema_name = row.get::<_, String>("schema_name");
        let object_name = row.get::<_, String>("object_name");
        let object_kind = row.get::<_, String>("object_kind");
        let kind = if object_kind == "view" {
            DatabaseObjectKind::View
        } else {
            DatabaseObjectKind::Table
        };
        let id_kind = if object_kind == "view" {
            "view"
        } else {
            "table"
        };

        schemas
            .entry(schema_name.clone())
            .or_default()
            .push(DatabaseTreeNode {
                id: format!("{id_kind}:{schema_name}.{object_name}"),
                label: object_name,
                kind,
                open: None,
                children: None,
            });
    }

    let schema_nodes = schemas
        .into_iter()
        .map(|(schema_name, objects)| DatabaseTreeNode {
            id: format!("schema:{schema_name}"),
            label: schema_name,
            kind: DatabaseObjectKind::Schema,
            open: Some(true),
            children: Some(objects),
        })
        .collect::<Vec<_>>();

    Ok(vec![DatabaseTreeNode {
        id: format!("server:{host}:{port}"),
        label: format!("{host}:{port}"),
        kind: DatabaseObjectKind::Database,
        open: Some(true),
        children: Some(vec![DatabaseTreeNode {
            id: format!("database:{database_name}"),
            label: database_name.to_string(),
            kind: DatabaseObjectKind::Database,
            open: Some(true),
            children: Some(schema_nodes),
        }]),
    }])
}

pub async fn object_details(
    client: &Client,
    object_id: &str,
) -> Result<DatabaseObjectDetails, AppError> {
    let object = parse_object_id(object_id)?;
    // The three queries are independent, and tokio-postgres pipelines concurrent
    // requests over the same connection: awaiting them together costs one
    // round-trip instead of three, which is what you feel on a remote database.
    let (columns, indexes, row_count) = futures_util::try_join!(
        load_columns(client, &object),
        load_indexes(client, &object),
        estimate_row_count(client, &object),
    )?;
    let safe_edit = indexes.iter().any(|index| index.primary);

    Ok(DatabaseObjectDetails {
        id: object_id.to_string(),
        name: object.name,
        schema: object.schema,
        kind: object.kind,
        engine: super::EngineKind::Postgresql,
        row_count,
        safe_edit,
        columns,
        indexes,
    })
}

async fn load_columns(
    client: &Client,
    object: &CatalogObject,
) -> Result<Vec<ColumnDefinition>, AppError> {
    let rows = client
        .query(
            // The index flags are resolved by aggregating pg_index once and
            // joining, instead of two correlated `exists` subqueries that the
            // planner had to re-run for every column of the table.
            "
            with target as (
              select c.oid
              from pg_catalog.pg_class c
              join pg_catalog.pg_namespace n on n.oid = c.relnamespace
              where n.nspname = $1
                and c.relname = $2
            ),
            indexed_columns as (
              select k.attnum, bool_or(i.indisprimary) as is_primary
              from pg_catalog.pg_index i
              join target t on t.oid = i.indrelid
              cross join unnest(i.indkey) as k(attnum)
              group by k.attnum
            )
            select
              a.attname as column_name,
              pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
              not a.attnotnull as nullable,
              coalesce(ic.is_primary, false) as primary_key,
              ic.attnum is not null as indexed
            from pg_catalog.pg_attribute a
            join target t on t.oid = a.attrelid
            left join indexed_columns ic on ic.attnum = a.attnum
            where a.attnum > 0
              and not a.attisdropped
            order by a.attnum
            ",
            &[&object.schema, &object.name],
        )
        .await?;

    Ok(rows
        .into_iter()
        .map(|row| ColumnDefinition {
            name: row.get("column_name"),
            data_type: row.get("data_type"),
            nullable: row.get("nullable"),
            primary_key: row.get("primary_key"),
            indexed: row.get("indexed"),
        })
        .collect())
}

async fn load_indexes(
    client: &Client,
    object: &CatalogObject,
) -> Result<Vec<IndexDefinition>, AppError> {
    let rows = client
        .query(
            "
            select
              ic.relname as index_name,
              i.indisunique as unique_index,
              i.indisprimary as primary_index,
              coalesce(
                array_agg(a.attname order by cols.ord) filter (where a.attname is not null),
                array[]::text[]
              ) as columns
            from pg_catalog.pg_index i
            join pg_catalog.pg_class tc on tc.oid = i.indrelid
            join pg_catalog.pg_namespace n on n.oid = tc.relnamespace
            join pg_catalog.pg_class ic on ic.oid = i.indexrelid
            left join lateral unnest(i.indkey) with ordinality as cols(attnum, ord) on true
            left join pg_catalog.pg_attribute a on a.attrelid = tc.oid and a.attnum = cols.attnum
            where n.nspname = $1
              and tc.relname = $2
            group by ic.relname, i.indisunique, i.indisprimary
            order by i.indisprimary desc, ic.relname
            ",
            &[&object.schema, &object.name],
        )
        .await?;

    Ok(rows
        .into_iter()
        .map(|row| IndexDefinition {
            name: row.get("index_name"),
            columns: row.get("columns"),
            unique: row.get("unique_index"),
            primary: row.get("primary_index"),
        })
        .collect())
}

async fn estimate_row_count(client: &Client, object: &CatalogObject) -> Result<i64, AppError> {
    let row = client
        .query_one(
            "
            select coalesce(c.reltuples::bigint, 0)
            from pg_catalog.pg_class c
            join pg_catalog.pg_namespace n on n.oid = c.relnamespace
            where n.nspname = $1
              and c.relname = $2
            ",
            &[&object.schema, &object.name],
        )
        .await?;

    Ok(row.get(0))
}

pub async fn run_query(client: &Client, sql: &str) -> Result<QueryExecution, AppError> {
    // Prepare first so we can read column metadata (names + types) even when the
    // result is empty. Preparing also rejects multi-statement SQL, keeping the
    // single-result QueryExecution shape valid.
    let statement = client.prepare(sql).await?;
    let columns: Vec<String> = statement
        .columns()
        .iter()
        .map(|column| column.name().to_string())
        .collect();
    let column_types: Vec<Type> = statement
        .columns()
        .iter()
        .map(|column| column.type_().clone())
        .collect();

    // Execute via the simple query protocol so every value comes back in Postgres'
    // canonical text form. Unlike binary decoding (query_raw on a prepared
    // statement), this handles every type — money, interval, cidr, macaddr, inet,
    // bytea, arrays, ranges, enums, etc. — without per-type decoders.
    let start = Instant::now();
    let messages = client.simple_query(sql).await?;
    let duration_ms = start.elapsed().as_millis();

    let mut converted: Vec<Vec<Option<String>>> = Vec::new();
    let mut rows_affected: Option<u64> = None;
    for message in messages {
        match message {
            SimpleQueryMessage::Row(row) => {
                converted.push(
                    (0..row.len())
                        .map(|index| format_cell(row.get(index), column_types.get(index)))
                        .collect(),
                );
            }
            SimpleQueryMessage::CommandComplete(count) => rows_affected = Some(count),
            // SimpleQueryMessage is #[non_exhaustive], so a catch-all is required.
            _ => {}
        }
    }

    // tokio-postgres 0.7 doesn't expose the command tag here, so derive the verb
    // from the SQL itself (e.g. "DELETE", "INSERT", "CREATE").
    let command_tag = sql
        .split_whitespace()
        .next()
        .map(|word| word.to_ascii_uppercase());

    let column_categories = column_types
        .iter()
        .map(|column_type| json_category(column_type).to_string())
        .collect();

    Ok(QueryExecution {
        columns,
        column_types: column_categories,
        row_count: converted.len(),
        rows: converted,
        duration_ms,
        rows_affected,
        command_tag,
    })
}

/// Maps a PostgreSQL type to a coarse JSON category the frontend uses to render
/// values with their natural JSON type in the JSON results view. Arrays are
/// converted to JSON text by `format_cell`, so they're reported as "json" too;
/// types without a native JSON representation (timestamps, money, …) are "string".
fn json_category(column_type: &Type) -> &'static str {
    if let Kind::Array(_) = column_type.kind() {
        return "json";
    }
    match *column_type {
        Type::INT2
        | Type::INT4
        | Type::INT8
        | Type::FLOAT4
        | Type::FLOAT8
        | Type::NUMERIC
        | Type::OID => "number",
        Type::BOOL => "boolean",
        Type::JSON | Type::JSONB => "json",
        _ => "string",
    }
}

/// Normalizes the canonical text Postgres returns for a cell, returning `None` for
/// SQL NULL. Most types pass through unchanged; a few are reshaped: bool as
/// `true`/`false`, timestamptz in UTC, json/jsonb re-serialized via serde, and
/// arrays converted from Postgres' `{…}` literal into a JSON array so the JSON
/// view can render them as real nested arrays.
fn format_cell(value: Option<&str>, column_type: Option<&Type>) -> Option<String> {
    let value = value?;

    if let Some(column_type) = column_type {
        if let Kind::Array(element_type) = column_type.kind() {
            return Some(postgres_array_to_json(value, element_type).to_string());
        }
    }

    match column_type {
        Some(&Type::BOOL) => Some(match value {
            "t" => "true".to_string(),
            "f" => "false".to_string(),
            other => other.to_string(),
        }),
        Some(&Type::TIMESTAMPTZ) => Some(
            chrono::DateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S%.f%#z")
                .map(|dt| dt.with_timezone(&chrono::Utc).to_string())
                .unwrap_or_else(|_| value.to_string()),
        ),
        Some(&Type::JSON) | Some(&Type::JSONB) => Some(
            serde_json::from_str::<serde_json::Value>(value)
                .map(|parsed| parsed.to_string())
                .unwrap_or_else(|_| value.to_string()),
        ),
        _ => Some(value.to_string()),
    }
}

/// Parses a PostgreSQL array literal (e.g. `{1,2,3}`, `{red,"a,b",NULL}`, nested
/// `{{1,2},{3,4}}`, or `jsonb[]` with quoted/escaped elements) into a JSON value,
/// converting each leaf element according to its element type. Falls back to the
/// raw string as a JSON string if the input isn't a `{…}` literal.
fn postgres_array_to_json(text: &str, element_type: &Type) -> serde_json::Value {
    let chars: Vec<char> = text.chars().collect();
    let mut pos = 0;
    if chars.first() != Some(&'{') {
        return serde_json::Value::String(text.to_string());
    }
    parse_array_value(&chars, &mut pos, element_type)
}

/// Parses a `{…}` group starting at `*pos` (which must point at `{`), recursing
/// into nested arrays and advancing `*pos` past the closing `}`.
fn parse_array_value(chars: &[char], pos: &mut usize, element_type: &Type) -> serde_json::Value {
    let mut items: Vec<serde_json::Value> = Vec::new();
    *pos += 1; // consume '{'
    while *pos < chars.len() {
        match chars[*pos] {
            '}' => {
                *pos += 1;
                break;
            }
            ',' => *pos += 1,
            '{' => items.push(parse_array_value(chars, pos, element_type)),
            '"' => {
                let element = parse_quoted_element(chars, pos);
                items.push(array_element_to_json(&element, element_type));
            }
            _ => {
                let start = *pos;
                while *pos < chars.len() && chars[*pos] != ',' && chars[*pos] != '}' {
                    *pos += 1;
                }
                let element: String = chars[start..*pos].iter().collect();
                let element = element.trim();
                if element.eq_ignore_ascii_case("NULL") {
                    items.push(serde_json::Value::Null);
                } else {
                    items.push(array_element_to_json(element, element_type));
                }
            }
        }
    }
    serde_json::Value::Array(items)
}

/// Reads a double-quoted array element starting at `*pos` (pointing at the opening
/// quote), un-escaping `\\` and `\"`, and advances `*pos` past the closing quote.
fn parse_quoted_element(chars: &[char], pos: &mut usize) -> String {
    let mut out = String::new();
    *pos += 1; // consume opening quote
    while *pos < chars.len() {
        match chars[*pos] {
            '\\' if *pos + 1 < chars.len() => {
                out.push(chars[*pos + 1]);
                *pos += 2;
            }
            '"' => {
                *pos += 1;
                break;
            }
            other => {
                out.push(other);
                *pos += 1;
            }
        }
    }
    out
}

/// Converts a single (already un-quoted/un-escaped) array element to a JSON value
/// based on the array's element type, mirroring `json_category`'s coarse buckets.
fn array_element_to_json(element: &str, element_type: &Type) -> serde_json::Value {
    match *element_type {
        Type::BOOL => serde_json::Value::Bool(element == "t" || element == "true"),
        Type::INT2
        | Type::INT4
        | Type::INT8
        | Type::FLOAT4
        | Type::FLOAT8
        | Type::NUMERIC
        | Type::OID => {
            if let Ok(int_value) = element.parse::<i64>() {
                serde_json::Value::from(int_value)
            } else if let Some(num) = element
                .parse::<f64>()
                .ok()
                .and_then(serde_json::Number::from_f64)
            {
                serde_json::Value::Number(num)
            } else {
                serde_json::Value::String(element.to_string())
            }
        }
        Type::JSON | Type::JSONB => serde_json::from_str(element)
            .unwrap_or_else(|_| serde_json::Value::String(element.to_string())),
        _ => serde_json::Value::String(element.to_string()),
    }
}

/// Wraps an identifier in double quotes, escaping any embedded quote, so schema
/// and object names with special characters round-trip safely in the dump.
fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// Numeric/boolean-free types whose canonical text form is a valid SQL literal as-is.
fn is_numeric_type(column_type: &Type) -> bool {
    matches!(
        *column_type,
        Type::INT2
            | Type::INT4
            | Type::INT8
            | Type::FLOAT4
            | Type::FLOAT8
            | Type::NUMERIC
            | Type::OID
    )
}

/// Renders a cell's canonical text form as a SQL literal for an INSERT: NULL stays
/// NULL, numeric types are emitted raw, and everything else is single-quoted with
/// `'` doubled. PostgreSQL casts the quoted text to the destination column type on
/// restore (bool `t`/`f`, dates, json, uuid, `{…}` arrays, `\x…` bytea, etc.).
fn sql_literal(value: Option<&str>, column_type: &Type) -> String {
    match value {
        None => "NULL".to_string(),
        Some(text) if is_numeric_type(column_type) => text.to_string(),
        Some(text) => format!("'{}'", text.replace('\'', "''")),
    }
}

struct BackupTable {
    schema: String,
    name: String,
    oid: u32,
    estimated_rows: i64,
}

/// Streams a full schema + data `.sql` dump of the connected database to a file in
/// `directory` named `file_name` (a `.sql` extension is appended if missing), emitting
/// `BACKUP_PROGRESS_EVENT` as it goes. The dump is ordered so it restores cleanly:
/// schemas, sequences, tables, data, then constraints and indexes (constraints come
/// after data so foreign keys don't depend on insertion order). Returns the final path.
pub async fn backup(
    app: &tauri::AppHandle,
    client: &Client,
    profile: &ConnectionProfile,
    directory: &str,
    file_name: &str,
) -> Result<String, AppError> {
    use std::io::Write;

    let mut file_name = file_name.trim().to_string();
    if file_name.is_empty() {
        file_name = format!("{}_backup.sql", profile.database);
    }
    if !file_name.to_ascii_lowercase().ends_with(".sql") {
        file_name.push_str(".sql");
    }
    let path = std::path::Path::new(directory).join(&file_name);

    let file = std::fs::File::create(&path).map_err(|e| AppError::Connection(e.to_string()))?;
    let mut writer = std::io::BufWriter::new(file);
    macro_rules! w {
        ($($arg:tt)*) => {
            write!(writer, $($arg)*).map_err(|e| AppError::Connection(e.to_string()))?
        };
    }

    emit_backup_progress(app, 0, "");

    w!("-- Databara backup of database \"{}\"\n", profile.database);
    w!("SET client_encoding = 'UTF8';\n\n");

    // 1. Schemas (skip `public`, which always exists).
    let schemas = client
        .query(
            "select nspname from pg_catalog.pg_namespace \
             where nspname not like 'pg_%' and nspname <> 'information_schema' \
             order by nspname",
            &[],
        )
        .await?;
    for row in &schemas {
        let schema: String = row.get(0);
        if schema != "public" {
            w!("CREATE SCHEMA IF NOT EXISTS {};\n", quote_ident(&schema));
        }
    }
    w!("\n");

    // 2. Sequences, with their current value (so serial columns continue correctly).
    let sequences = client
        .query(
            "select n.nspname as schema, c.relname as name \
             from pg_catalog.pg_class c \
             join pg_catalog.pg_namespace n on n.oid = c.relnamespace \
             where c.relkind = 'S' and n.nspname not like 'pg_%' and n.nspname <> 'information_schema' \
             order by n.nspname, c.relname",
            &[],
        )
        .await?;
    for row in &sequences {
        let schema: String = row.get("schema");
        let name: String = row.get("name");
        let qualified = format!("{}.{}", quote_ident(&schema), quote_ident(&name));
        w!("CREATE SEQUENCE IF NOT EXISTS {};\n", qualified);
        let value_row = client
            .query_one(
                &format!("select last_value, is_called from {}", qualified),
                &[],
            )
            .await?;
        let last_value: i64 = value_row.get("last_value");
        let is_called: bool = value_row.get("is_called");
        let regclass = qualified.replace('\'', "''");
        w!(
            "SELECT pg_catalog.setval('{}', {}, {});\n",
            regclass,
            last_value,
            is_called
        );
    }
    if !sequences.is_empty() {
        w!("\n");
    }

    // Collect base tables once; reused for DDL, data, constraints and indexes.
    let table_rows = client
        .query(
            "select n.nspname as schema, c.relname as name, c.oid as oid, \
                    greatest(coalesce(c.reltuples::bigint, 0), 0) as est \
             from pg_catalog.pg_class c \
             join pg_catalog.pg_namespace n on n.oid = c.relnamespace \
             where c.relkind = 'r' and n.nspname not like 'pg_%' and n.nspname <> 'information_schema' \
             order by n.nspname, c.relname",
            &[],
        )
        .await?;
    let tables: Vec<BackupTable> = table_rows
        .iter()
        .map(|row| BackupTable {
            schema: row.get("schema"),
            name: row.get("name"),
            oid: row.get("oid"),
            estimated_rows: row.get("est"),
        })
        .collect();
    let total_rows: i64 = tables.iter().map(|t| t.estimated_rows).sum::<i64>().max(1);

    // 3. Table definitions.
    for table in &tables {
        let columns = client
            .query(
                "select a.attname as name, \
                        pg_catalog.format_type(a.atttypid, a.atttypmod) as type, \
                        a.attnotnull as notnull, \
                        pg_catalog.pg_get_expr(d.adbin, d.adrelid) as default \
                 from pg_catalog.pg_attribute a \
                 left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum \
                 where a.attrelid = $1 and a.attnum > 0 and not a.attisdropped \
                 order by a.attnum",
                &[&table.oid],
            )
            .await?;
        let qualified = format!(
            "{}.{}",
            quote_ident(&table.schema),
            quote_ident(&table.name)
        );
        let defs: Vec<String> = columns
            .iter()
            .map(|col| {
                let name: String = col.get("name");
                let data_type: String = col.get("type");
                let not_null: bool = col.get("notnull");
                let default: Option<String> = col.get("default");
                let mut line = format!("  {} {}", quote_ident(&name), data_type);
                if let Some(default) = default {
                    line.push_str(&format!(" DEFAULT {}", default));
                }
                if not_null {
                    line.push_str(" NOT NULL");
                }
                line
            })
            .collect();
        w!("CREATE TABLE {} (\n{}\n);\n\n", qualified, defs.join(",\n"));
    }

    // 4. Data, row by row, with progress tracked against the estimated total.
    let mut processed: i64 = 0;
    for table in &tables {
        let qualified = format!(
            "{}.{}",
            quote_ident(&table.schema),
            quote_ident(&table.name)
        );
        let select_sql = format!("select * from {}", qualified);
        let statement = client.prepare(&select_sql).await?;
        let column_types: Vec<Type> = statement
            .columns()
            .iter()
            .map(|column| column.type_().clone())
            .collect();
        let column_list = statement
            .columns()
            .iter()
            .map(|column| quote_ident(column.name()))
            .collect::<Vec<_>>()
            .join(", ");

        let percent = (5 + (processed * 90 / total_rows)).min(95) as u8;
        emit_backup_progress(app, percent, &table.name);

        let messages = client.simple_query(&select_sql).await?;
        let mut wrote_header = false;
        let mut rows_in_table: i64 = 0;
        for message in messages {
            if let SimpleQueryMessage::Row(row) = message {
                if !wrote_header {
                    w!("-- Data for {}\n", qualified);
                    wrote_header = true;
                }
                let values: Vec<String> = (0..row.len())
                    .map(|index| sql_literal(row.get(index), &column_types[index]))
                    .collect();
                w!(
                    "INSERT INTO {} ({}) VALUES ({});\n",
                    qualified,
                    column_list,
                    values.join(", ")
                );
                processed += 1;
                rows_in_table += 1;
                if rows_in_table % 1000 == 0 {
                    let percent = (5 + (processed * 90 / total_rows)).min(95) as u8;
                    emit_backup_progress(app, percent, &table.name);
                }
            }
        }
        if wrote_header {
            w!("\n");
        }
    }

    // 5. Constraints (after data so foreign keys don't depend on insertion order).
    let mut wrote_constraints_header = false;
    for table in &tables {
        let constraints = client
            .query(
                "select conname, pg_catalog.pg_get_constraintdef(oid) as def \
                 from pg_catalog.pg_constraint where conrelid = $1 \
                 order by contype desc, conname",
                &[&table.oid],
            )
            .await?;
        let qualified = format!(
            "{}.{}",
            quote_ident(&table.schema),
            quote_ident(&table.name)
        );
        for row in &constraints {
            if !wrote_constraints_header {
                w!("-- Constraints\n");
                wrote_constraints_header = true;
            }
            let conname: String = row.get("conname");
            let def: String = row.get("def");
            w!(
                "ALTER TABLE {} ADD CONSTRAINT {} {};\n",
                qualified,
                quote_ident(&conname),
                def
            );
        }
    }
    if wrote_constraints_header {
        w!("\n");
    }

    // 6. Indexes that aren't backing a primary key or a constraint.
    let mut wrote_indexes_header = false;
    for table in &tables {
        let indexes = client
            .query(
                "select pg_catalog.pg_get_indexdef(i.indexrelid) as def \
                 from pg_catalog.pg_index i \
                 where i.indrelid = $1 and not i.indisprimary \
                   and not exists (select 1 from pg_catalog.pg_constraint c where c.conindid = i.indexrelid)",
                &[&table.oid],
            )
            .await?;
        for row in &indexes {
            if !wrote_indexes_header {
                w!("-- Indexes\n");
                wrote_indexes_header = true;
            }
            let def: String = row.get("def");
            w!("{};\n", def);
        }
    }

    writer
        .flush()
        .map_err(|e| AppError::Connection(e.to_string()))?;
    emit_backup_progress(app, 100, "");

    Ok(path.to_string_lossy().to_string())
}
