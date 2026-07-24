import type { Monaco } from "@monaco-editor/react";
import type * as monacoEditor from "monaco-editor";
import { translate } from "../i18n/translate";
import { qualifyName, quoteIdentifier } from "../sqlIdentifiers";
import type { DatabaseEngine, DatabaseObjectDetails } from "../types";

type CompletionRange = {
  endColumn: number;
  endLineNumber: number;
  startColumn: number;
  startLineNumber: number;
};

type SqlCompletionSnippet = {
  detail: string;
  insertText: string;
  label: string;
};

type SqlCompletionProfile = {
  functions: string[];
  keywords: string[];
  snippets: SqlCompletionSnippet[];
  types: string[];
};

export type SqlCompletionContext = {
  selectedObject: DatabaseObjectDetails | null;
};

const sqlIdentifierPrefixPattern = /[A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)*$/u;

const postgresqlKeywords = [
  "ABORT",
  "ABSOLUTE",
  "ACCESS",
  "ACTION",
  "ADD",
  "ADMIN",
  "AFTER",
  "AGGREGATE",
  "ALL",
  "ALTER",
  "ALWAYS",
  "ANALYSE",
  "ANALYZE",
  "AND",
  "ANY",
  "ARRAY",
  "AS",
  "ASC",
  "ASSERTION",
  "ASYMMETRIC",
  "AT",
  "ATTACH",
  "AUTHORIZATION",
  "BACKWARD",
  "BEFORE",
  "BEGIN",
  "BETWEEN",
  "BIGINT",
  "BINARY",
  "BOTH",
  "BY",
  "CACHE",
  "CALL",
  "CALLED",
  "CASCADE",
  "CASCADED",
  "CASE",
  "CAST",
  "CHECK",
  "CHECKPOINT",
  "CLASS",
  "CLOSE",
  "CLUSTER",
  "COALESCE",
  "COLLATE",
  "COLLATION",
  "COLUMN",
  "COMMENT",
  "COMMIT",
  "COMMITTED",
  "CONCURRENTLY",
  "CONFIGURATION",
  "CONFLICT",
  "CONNECTION",
  "CONSTRAINT",
  "CONSTRAINTS",
  "CONTENT",
  "CONTINUE",
  "CONVERSION",
  "COPY",
  "CREATE",
  "CROSS",
  "CURRENT",
  "CURRENT_CATALOG",
  "CURRENT_DATE",
  "CURRENT_ROLE",
  "CURRENT_SCHEMA",
  "CURRENT_TIME",
  "CURRENT_TIMESTAMP",
  "CURRENT_USER",
  "CURSOR",
  "CYCLE",
  "DATA",
  "DATABASE",
  "DAY",
  "DEALLOCATE",
  "DEC",
  "DECIMAL",
  "DECLARE",
  "DEFAULT",
  "DEFAULTS",
  "DEFERRABLE",
  "DEFERRED",
  "DEFINER",
  "DELETE",
  "DELIMITER",
  "DELIMITERS",
  "DEPENDS",
  "DESC",
  "DETACH",
  "DICTIONARY",
  "DISABLE",
  "DISCARD",
  "DISTINCT",
  "DO",
  "DOCUMENT",
  "DOMAIN",
  "DOUBLE",
  "DROP",
  "EACH",
  "ELSE",
  "ENABLE",
  "ENCODING",
  "ENCRYPTED",
  "END",
  "ENUM",
  "ESCAPE",
  "EVENT",
  "EXCEPT",
  "EXCLUDE",
  "EXCLUDING",
  "EXCLUSIVE",
  "EXECUTE",
  "EXISTS",
  "EXPLAIN",
  "EXTENSION",
  "EXTERNAL",
  "EXTRACT",
  "FALSE",
  "FETCH",
  "FILTER",
  "FIRST",
  "FOLLOWING",
  "FOR",
  "FORCE",
  "FOREIGN",
  "FORWARD",
  "FREEZE",
  "FROM",
  "FULL",
  "FUNCTION",
  "FUNCTIONS",
  "GENERATED",
  "GLOBAL",
  "GRANT",
  "GRANTED",
  "GREATEST",
  "GROUP",
  "GROUPING",
  "GROUPS",
  "HANDLER",
  "HAVING",
  "HEADER",
  "HOLD",
  "HOUR",
  "IDENTITY",
  "IF",
  "ILIKE",
  "IMMEDIATE",
  "IMMUTABLE",
  "IMPLICIT",
  "IMPORT",
  "IN",
  "INCLUDE",
  "INCLUDING",
  "INCREMENT",
  "INDEX",
  "INDEXES",
  "INHERIT",
  "INHERITS",
  "INITIALLY",
  "INLINE",
  "INNER",
  "INOUT",
  "INPUT",
  "INSERT",
  "INSTEAD",
  "INTERSECT",
  "INTERVAL",
  "INTO",
  "INVOKER",
  "IS",
  "ISNULL",
  "ISOLATION",
  "JOIN",
  "KEY",
  "LABEL",
  "LANGUAGE",
  "LARGE",
  "LAST",
  "LATERAL",
  "LEADING",
  "LEAKPROOF",
  "LEAST",
  "LEFT",
  "LEVEL",
  "LIKE",
  "LIMIT",
  "LISTEN",
  "LOAD",
  "LOCAL",
  "LOCALTIME",
  "LOCALTIMESTAMP",
  "LOCK",
  "LOCKED",
  "LOGGED",
  "MAPPING",
  "MATCH",
  "MATERIALIZED",
  "MAXVALUE",
  "MINUTE",
  "MINVALUE",
  "MODE",
  "MONTH",
  "MOVE",
  "NAME",
  "NAMES",
  "NATURAL",
  "NO",
  "NONE",
  "NORMALIZE",
  "NOT",
  "NOTHING",
  "NOTIFY",
  "NOTNULL",
  "NOWAIT",
  "NULL",
  "NULLIF",
  "NULLS",
  "OBJECT",
  "OF",
  "OFF",
  "OFFSET",
  "OIDS",
  "ON",
  "ONLY",
  "OPERATOR",
  "OPTION",
  "OPTIONS",
  "OR",
  "ORDER",
  "ORDINALITY",
  "OTHERS",
  "OUT",
  "OUTER",
  "OVER",
  "OVERLAPS",
  "OVERLAY",
  "OVERRIDING",
  "OWNED",
  "OWNER",
  "PARALLEL",
  "PARTITION",
  "PASSING",
  "PLACING",
  "PLANS",
  "POLICY",
  "PRECEDING",
  "PRECISION",
  "PREPARE",
  "PREPARED",
  "PRESERVE",
  "PRIMARY",
  "PRIOR",
  "PRIVILEGES",
  "PROCEDURAL",
  "PROCEDURE",
  "PROCEDURES",
  "PROGRAM",
  "PUBLICATION",
  "QUOTE",
  "RANGE",
  "READ",
  "REAL",
  "REASSIGN",
  "RECHECK",
  "RECURSIVE",
  "REF",
  "REFERENCES",
  "REFERENCING",
  "REFRESH",
  "REINDEX",
  "RELATIVE",
  "RELEASE",
  "RENAME",
  "REPEATABLE",
  "REPLACE",
  "REPLICA",
  "RESET",
  "RESTART",
  "RESTRICT",
  "RETURNING",
  "RETURNS",
  "REVOKE",
  "RIGHT",
  "ROLE",
  "ROLLBACK",
  "ROLLUP",
  "ROUTINE",
  "ROUTINES",
  "ROW",
  "ROWS",
  "RULE",
  "SAVEPOINT",
  "SCHEMA",
  "SCHEMAS",
  "SCROLL",
  "SEARCH",
  "SECOND",
  "SECURITY",
  "SELECT",
  "SEQUENCE",
  "SEQUENCES",
  "SERIALIZABLE",
  "SERVER",
  "SESSION",
  "SESSION_USER",
  "SET",
  "SETOF",
  "SHARE",
  "SHOW",
  "SIMILAR",
  "SIMPLE",
  "SKIP",
  "SMALLINT",
  "SNAPSHOT",
  "SOME",
  "SQL",
  "STABLE",
  "STANDALONE",
  "START",
  "STATEMENT",
  "STATISTICS",
  "STDIN",
  "STDOUT",
  "STORAGE",
  "STORED",
  "STRICT",
  "STRIP",
  "SUBSCRIPTION",
  "SUBSTRING",
  "SUPPORT",
  "SYMMETRIC",
  "SYSID",
  "SYSTEM",
  "TABLE",
  "TABLES",
  "TABLESAMPLE",
  "TABLESPACE",
  "TEMP",
  "TEMPLATE",
  "TEMPORARY",
  "TEXT",
  "THEN",
  "TIES",
  "TIME",
  "TIMESTAMP",
  "TO",
  "TRAILING",
  "TRANSACTION",
  "TRANSFORM",
  "TREAT",
  "TRIGGER",
  "TRIM",
  "TRUE",
  "TRUNCATE",
  "TRUSTED",
  "TYPE",
  "TYPES",
  "UESCAPE",
  "UNBOUNDED",
  "UNCOMMITTED",
  "UNENCRYPTED",
  "UNION",
  "UNIQUE",
  "UNKNOWN",
  "UNLISTEN",
  "UNLOGGED",
  "UNTIL",
  "UPDATE",
  "USER",
  "USING",
  "VACUUM",
  "VALID",
  "VALIDATE",
  "VALIDATOR",
  "VALUE",
  "VALUES",
  "VARIADIC",
  "VERBOSE",
  "VERSION",
  "VIEW",
  "VIEWS",
  "VOLATILE",
  "WHEN",
  "WHERE",
  "WHITESPACE",
  "WINDOW",
  "WITH",
  "WITHIN",
  "WITHOUT",
  "WORK",
  "WRAPPER",
  "WRITE",
  "XMLATTRIBUTES",
  "XMLCONCAT",
  "XMLELEMENT",
  "XMLEXISTS",
  "XMLFOREST",
  "XMLNAMESPACES",
  "XMLPARSE",
  "XMLPI",
  "XMLROOT",
  "XMLSERIALIZE",
  "XMLTABLE",
  "YEAR",
  "YES",
  "ZONE",
] as const;

const postgresqlTypes = [
  "BIGINT",
  "BIGSERIAL",
  "BIT",
  "BOOLEAN",
  "BOX",
  "BYTEA",
  "CHAR",
  "CIDR",
  "CIRCLE",
  "DATE",
  "DECIMAL",
  "DOUBLE PRECISION",
  "INET",
  "INTEGER",
  "INTERVAL",
  "JSON",
  "JSONB",
  "LINE",
  "LSEG",
  "MACADDR",
  "MONEY",
  "NUMERIC",
  "PATH",
  "POINT",
  "POLYGON",
  "REAL",
  "SERIAL",
  "SMALLINT",
  "SMALLSERIAL",
  "TEXT",
  "TIME",
  "TIMESTAMP",
  "TSQUERY",
  "TSVECTOR",
  "UUID",
  "VARCHAR",
  "XML",
] as const;

const postgresqlFunctions = [
  "ABS",
  "AVG",
  "CEIL",
  "CEILING",
  "COALESCE",
  "COUNT",
  "CURRENT_DATE",
  "CURRENT_TIME",
  "CURRENT_TIMESTAMP",
  "DATE_PART",
  "DATE_TRUNC",
  "EXTRACT",
  "FLOOR",
  "GREATEST",
  "JSON_AGG",
  "JSON_BUILD_OBJECT",
  "JSONB_AGG",
  "LENGTH",
  "LOWER",
  "MAX",
  "MIN",
  "NOW",
  "NULLIF",
  "ROUND",
  "SUM",
  "TO_CHAR",
  "TO_DATE",
  "TO_JSON",
  "TO_TIMESTAMP",
  "TRIM",
  "UPPER",
] as const;

const postgresqlSnippets: SqlCompletionSnippet[] = [
  {
    detail: translate("editor.completion.snippet.select.detail"),
    insertText: "SELECT ${1:*}\nFROM ${2:table_name}\nLIMIT ${3:100};",
    label: translate("editor.completion.snippet.select.label"),
  },
  {
    detail: translate("editor.completion.snippet.where.detail"),
    insertText: "WHERE ${1:column_name} = ${2:value}",
    label: translate("editor.completion.snippet.where.label"),
  },
  {
    detail: translate("editor.completion.snippet.orderBy.detail"),
    insertText: "ORDER BY ${1:column_name} ${2|ASC,DESC|}",
    label: translate("editor.completion.snippet.orderBy.label"),
  },
  {
    detail: translate("editor.completion.snippet.groupBy.detail"),
    insertText: "GROUP BY ${1:column_name}",
    label: translate("editor.completion.snippet.groupBy.label"),
  },
  {
    detail: translate("editor.completion.snippet.limit.detail"),
    insertText: "LIMIT ${1:100}",
    label: translate("editor.completion.snippet.limit.label"),
  },
  {
    detail: translate("editor.completion.snippet.join.detail"),
    insertText:
      "JOIN ${1:table_name} ON ${2:left_table}.${3:column_name} = ${1:table_name}.${3:column_name}",
    label: translate("editor.completion.snippet.join.label"),
  },
  {
    detail: translate("editor.completion.snippet.insert.detail"),
    insertText: "INSERT INTO ${1:table_name} (${2:columns})\nVALUES (${3:values});",
    label: translate("editor.completion.snippet.insert.label"),
  },
  {
    detail: translate("editor.completion.snippet.update.detail"),
    insertText: "UPDATE ${1:table_name}\nSET ${2:column_name} = ${3:value}\nWHERE ${4:condition};",
    label: translate("editor.completion.snippet.update.label"),
  },
  {
    detail: translate("editor.completion.snippet.delete.detail"),
    insertText: "DELETE FROM ${1:table_name}\nWHERE ${2:condition};",
    label: translate("editor.completion.snippet.delete.label"),
  },
];

const postgresqlProfile: SqlCompletionProfile = {
  functions: [...postgresqlFunctions],
  keywords: [...postgresqlKeywords],
  snippets: postgresqlSnippets,
  types: [...postgresqlTypes],
};

// Per-engine completion profiles. Engines without a dedicated profile fall back
// to the PostgreSQL one (broad ANSI-SQL coverage) via `getSqlCompletionProfile`.
const sqlCompletionProfiles: Partial<Record<DatabaseEngine, SqlCompletionProfile>> = {
  postgresql: postgresqlProfile,
};

function getSqlCompletionProfile(engine: DatabaseEngine | undefined): SqlCompletionProfile {
  return sqlCompletionProfiles[engine ?? "postgresql"] ?? postgresqlProfile;
}

function getCompletionRange(
  model: monacoEditor.editor.ITextModel,
  position: monacoEditor.Position,
): CompletionRange {
  const word = model.getWordUntilPosition(position);
  const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
  const identifierPrefix = linePrefix.match(sqlIdentifierPrefixPattern)?.[0];

  return {
    endColumn: word.endColumn,
    endLineNumber: position.lineNumber,
    startColumn: identifierPrefix ? position.column - identifierPrefix.length : word.startColumn,
    startLineNumber: position.lineNumber,
  };
}

function qualifyObjectName(details: DatabaseObjectDetails) {
  return `${details.schema}.${details.name}`;
}

type CompletionTemplate = Omit<monacoEditor.languages.CompletionItem, "range">;

// Static suggestions (keywords/types/functions/snippets) never change for an engine, so build
// them once per engine and only attach the per-request `range` on each completion call.
const staticSuggestionCache = new Map<DatabaseEngine, CompletionTemplate[]>();

const dotQualifierPattern = /([A-Za-z_][\w$]*)\.\w*$/u;

// Clause keywords that can directly follow a table name; used to avoid mistaking them for an alias.
const aliasStopWords = new Set([
  "where",
  "on",
  "using",
  "group",
  "order",
  "limit",
  "offset",
  "having",
  "join",
  "inner",
  "left",
  "right",
  "full",
  "cross",
  "union",
  "returning",
  "set",
  "values",
  "as",
]);

function getStaticSuggestions(monaco: Monaco, engine: DatabaseEngine): CompletionTemplate[] {
  const cached = staticSuggestionCache.get(engine);
  if (cached) return cached;

  const profile = getSqlCompletionProfile(engine);
  const templates: CompletionTemplate[] = [
    ...profile.snippets.map((snippet) => ({
      detail: snippet.detail,
      insertText: snippet.insertText,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      kind: monaco.languages.CompletionItemKind.Snippet,
      label: snippet.label,
      sortText: `2_${snippet.label}`,
    })),
    ...profile.keywords.map((keyword) => ({
      detail: translate("editor.completion.keyword"),
      insertText: keyword,
      kind: monaco.languages.CompletionItemKind.Keyword,
      label: keyword,
      sortText: `3_${keyword}`,
    })),
    ...profile.types.map((type) => ({
      detail: translate("editor.completion.type"),
      insertText: type,
      kind: monaco.languages.CompletionItemKind.TypeParameter,
      label: type,
      sortText: `4_${type}`,
    })),
    ...profile.functions.map((name) => ({
      detail: translate("editor.completion.function"),
      insertText: `${name}($1)`,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      kind: monaco.languages.CompletionItemKind.Function,
      label: name,
      sortText: `5_${name}`,
    })),
  ];

  staticSuggestionCache.set(engine, templates);
  return templates;
}

function withRange(
  templates: CompletionTemplate[],
  range: CompletionRange,
): monacoEditor.languages.CompletionItem[] {
  return templates.map((template) => ({ ...template, range }));
}

function buildTableSuggestions(
  monaco: Monaco,
  selectedObject: DatabaseObjectDetails,
  range: CompletionRange,
): monacoEditor.languages.CompletionItem[] {
  const qualifiedName = qualifyObjectName(selectedObject);
  // Labels stay human-readable (unquoted); the inserted text is quoted so mixed-case
  // identifiers are not folded to lowercase by PostgreSQL.
  return [
    {
      detail: `${selectedObject.kind} ${qualifiedName}`,
      insertText: qualifyName(selectedObject.schema, selectedObject.name),
      kind: monaco.languages.CompletionItemKind.Struct,
      label: qualifiedName,
      range,
      sortText: `0_${qualifiedName}`,
    },
    {
      detail: `${selectedObject.kind} ${qualifiedName}`,
      insertText: quoteIdentifier(selectedObject.name),
      kind: monaco.languages.CompletionItemKind.Struct,
      label: selectedObject.name,
      range,
      sortText: `0_${selectedObject.name}`,
    },
  ];
}

function buildColumnSuggestions(
  monaco: Monaco,
  selectedObject: DatabaseObjectDetails,
  range: CompletionRange,
): monacoEditor.languages.CompletionItem[] {
  return selectedObject.columns.map((column) => ({
    detail: column.dataType,
    insertText: quoteIdentifier(column.name),
    kind: monaco.languages.CompletionItemKind.Field,
    label: column.name,
    range,
    sortText: `1_${column.name}`,
  }));
}

// When the cursor sits right after `<identifier>.`, returns that identifier (the column qualifier).
function getDotQualifier(
  model: monacoEditor.editor.ITextModel,
  position: monacoEditor.Position,
): string | null {
  const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
  return linePrefix.match(dotQualifierPattern)?.[1] ?? null;
}

// Range covering only the partial word after the dot, so inserting a column keeps the `table.` prefix.
function getWordRange(
  model: monacoEditor.editor.ITextModel,
  position: monacoEditor.Position,
): CompletionRange {
  const word = model.getWordUntilPosition(position);
  return {
    endColumn: word.endColumn,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    startLineNumber: position.lineNumber,
  };
}

// True when the dot qualifier refers to the selected object, either by name or by a table alias
// declared in a FROM/JOIN clause (e.g. `SELECT o. FROM orders o`).
function qualifierMatchesObject(
  qualifier: string,
  selectedObject: DatabaseObjectDetails,
  model: monacoEditor.editor.ITextModel,
): boolean {
  const lowered = qualifier.toLowerCase();
  if (lowered === selectedObject.name.toLowerCase()) return true;
  if (aliasStopWords.has(lowered)) return false;

  const escapedName = selectedObject.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const aliasPattern = new RegExp(
    `(?:from|join)\\s+(?:[A-Za-z_][\\w$]*\\.)?${escapedName}\\s+(?:as\\s+)?([A-Za-z_][\\w$]*)`,
    "iu",
  );
  const alias = model.getValue().match(aliasPattern)?.[1]?.toLowerCase();
  return Boolean(alias) && !aliasStopWords.has(alias!) && alias === lowered;
}

export function registerSqlCompletionProvider(
  monaco: Monaco,
  getContext: () => SqlCompletionContext,
) {
  return monaco.languages.registerCompletionItemProvider("sql", {
    triggerCharacters: ["."],
    provideCompletionItems(model: monacoEditor.editor.ITextModel, position: monacoEditor.Position) {
      const { selectedObject } = getContext();
      const engine = selectedObject?.engine ?? "postgresql";
      const dotQualifier = getDotQualifier(model, position);

      // After `<qualifier>.` only column names make sense; never flood with keywords there.
      if (dotQualifier) {
        if (selectedObject && qualifierMatchesObject(dotQualifier, selectedObject, model)) {
          return {
            suggestions: buildColumnSuggestions(
              monaco,
              selectedObject,
              getWordRange(model, position),
            ),
          };
        }
        return { suggestions: [] };
      }

      const range = getCompletionRange(model, position);
      const suggestions = withRange(getStaticSuggestions(monaco, engine), range);
      if (selectedObject) {
        suggestions.push(
          ...buildTableSuggestions(monaco, selectedObject, range),
          ...buildColumnSuggestions(monaco, selectedObject, range),
        );
      }

      return { suggestions };
    },
  });
}
