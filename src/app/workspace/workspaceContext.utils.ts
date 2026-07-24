import { connectionEngineLabel } from "../connectionEngines";
import type { StoredConnectionDraft } from "../databaraService";
import { translate } from "../i18n/translate";
import { qualifyName, quoteIdentifier } from "../sqlIdentifiers";
import type { ConnectionDraft, DatabaseEngine, DatabaseTreeNode } from "../types";
import { savedConnectionNodeId } from "./workspaceCore";

export function serverNodeId(connection: Pick<ConnectionDraft, "engine" | "host" | "port">) {
  return `server:${connection.engine}:${connection.host}:${connection.port}`;
}

export function activeDatabaseNodeId(connection: StoredConnectionDraft) {
  return `database:${connection.database}`;
}

export function connectionKey(
  connection: Pick<ConnectionDraft, "database" | "engine" | "host" | "port" | "user">,
) {
  return `${connection.engine}:${connection.host}:${connection.port}:${connection.database}:${connection.user}`;
}

// Connections are grouped by server (`host:port`); each server node holds its
// databases, which in turn hold the schema → table tree from the backend. A
// saved-but-not-yet-connected connection contributes a placeholder database
// node so it can be clicked to connect.
export function buildStoredConnectionTree(
  storedConnections: StoredConnectionDraft[],
  activeTree: DatabaseTreeNode[],
  serverLabels: Record<string, string> = {},
) {
  // Active server nodes carry the backend's schema/table subtree; index them by
  // id for data lookup only — ordering comes from `storedConnections`, never from
  // a node label (which changes on rename) or from connection status.
  const activeServers = new Map(activeTree.map((node) => [node.id, node]));

  // Order is the creation order of `storedConnections`: first appearance of each
  // server, and order of appearance of each database within it.
  const serverNodes = new Map<string, DatabaseTreeNode>();
  const seenDatabases = new Map<string, Set<string>>();

  for (const connection of storedConnections) {
    const serverId = serverNodeId(connection);
    const activeServer = activeServers.get(serverId);

    if (!serverNodes.has(serverId)) {
      serverNodes.set(serverId, {
        children: [],
        id: serverId,
        kind: "database",
        label:
          serverLabels[serverId] ?? activeServer?.label ?? `${connection.host}:${connection.port}`,
        open: activeServer?.open ?? true,
      });
      seenDatabases.set(serverId, new Set());
    }

    const seen = seenDatabases.get(serverId)!;
    if (seen.has(connection.database)) continue;
    seen.add(connection.database);

    // Reuse the live node (with its schema/table children) when connected;
    // otherwise a clickable placeholder that connects on demand.
    const activeDatabase = activeServer?.children?.find(
      (child) => child.label === connection.database,
    );
    serverNodes.get(serverId)!.children!.push(
      activeDatabase ?? {
        id: savedConnectionNodeId(connection),
        kind: "database",
        label: connection.database,
      },
    );
  }

  // Defensive: surface any active server/database that isn't in storedConnections
  // (shouldn't happen — connecting always saves) so nothing silently disappears.
  for (const activeServer of activeTree) {
    if (!serverNodes.has(activeServer.id)) {
      serverNodes.set(activeServer.id, {
        ...activeServer,
        label: serverLabels[activeServer.id] ?? activeServer.label,
      });
      seenDatabases.set(
        activeServer.id,
        new Set((activeServer.children ?? []).map((c) => c.label)),
      );
      continue;
    }
    const seen = seenDatabases.get(activeServer.id)!;
    for (const child of activeServer.children ?? []) {
      if (seen.has(child.label)) continue;
      seen.add(child.label);
      serverNodes.get(activeServer.id)!.children!.push(child);
    }
  }

  return [...serverNodes.values()];
}

export function mergeExplorerTree(
  currentTree: DatabaseTreeNode[],
  incomingTree: DatabaseTreeNode[],
) {
  const nextServers = new Map(currentTree.map((node) => [node.id, node]));

  for (const incomingServer of incomingTree) {
    const currentServer = nextServers.get(incomingServer.id);
    if (!currentServer) {
      nextServers.set(incomingServer.id, incomingServer);
      continue;
    }

    const databaseNodes = new Map((currentServer.children ?? []).map((node) => [node.label, node]));

    for (const incomingDatabase of incomingServer.children ?? []) {
      databaseNodes.set(incomingDatabase.label, incomingDatabase);
    }

    nextServers.set(incomingServer.id, {
      ...incomingServer,
      children: [...databaseNodes.values()],
    });
  }

  return [...nextServers.values()];
}

export function removeConnectionFromTree(
  tree: DatabaseTreeNode[],
  connectionToDelete: StoredConnectionDraft,
) {
  const serverId = serverNodeId(connectionToDelete);
  const databaseIds = new Set([
    savedConnectionNodeId(connectionToDelete),
    activeDatabaseNodeId(connectionToDelete),
  ]);

  return tree
    .map((serverNode) => {
      if (serverNode.id !== serverId) return serverNode;

      const children = (serverNode.children ?? []).filter((child) => !databaseIds.has(child.id));
      return { ...serverNode, children };
    })
    .filter((serverNode) => (serverNode.children?.length ?? 0) > 0);
}

export function readErrorMessage(error: unknown) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return translate("validation.unexpectedError");
}

/**
 * Replaces whole-word, case-insensitive occurrences of a bare identifier with
 * `replacement`, skipping regions where it must not be touched: single-quoted string
 * literals, double-quoted identifiers, and `--` / block comments. Dollar-quoted strings
 * are not handled (rare in ad-hoc queries); the retry re-validates against the server.
 */
function replaceUnquotedIdentifier(sql: string, identifier: string, replacement: string): string {
  const target = identifier.toLowerCase();
  const isWordChar = (ch: string) => /[A-Za-z0-9_$]/.test(ch);
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    // Single-quoted string literal ('' escapes a quote).
    if (ch === "'") {
      const start = i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      out += sql.slice(start, i);
      continue;
    }
    // Double-quoted identifier ("" escapes a quote) — already quoted, leave untouched.
    if (ch === '"') {
      const start = i++;
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') {
          i += 2;
          continue;
        }
        if (sql[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      out += sql.slice(start, i);
      continue;
    }
    // Line comment.
    if (ch === "-" && next === "-") {
      const start = i;
      while (i < sql.length && sql[i] !== "\n") i++;
      out += sql.slice(start, i);
      continue;
    }
    // Block comment.
    if (ch === "/" && next === "*") {
      const start = i;
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i = Math.min(i + 2, sql.length);
      out += sql.slice(start, i);
      continue;
    }
    // Word token (identifier / keyword).
    if (isWordChar(ch)) {
      const start = i;
      while (i < sql.length && isWordChar(sql[i])) i++;
      const word = sql.slice(start, i);
      out += word.toLowerCase() === target ? replacement : word;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * When a query fails because PostgreSQL folded an unquoted identifier to lowercase
 * (e.g. `companyId` → `companyid`), the server returns a hint naming the real object.
 * This parses that hint and returns the SQL rewritten with the identifier quoted so the
 * query can be retried. Returns `null` unless the mismatch is *purely* about case —
 * so typos and genuinely different suggestions are never silently rewritten.
 */
export function correctSqlFromHint(sql: string, errorMessage: string): string | null {
  const missing = errorMessage.match(/(?:column|relation) "([^"]+)" does not exist/i);
  const hint = errorMessage.match(
    /Perhaps you meant to reference the (?:column|table|relation) "([^"]+)"/i,
  );
  if (!missing || !hint) return null;

  const wrong = missing[1];
  // The suggestion may be qualified (e.g. `user.companyId`); the identifier we need to
  // quote is the last dot-separated segment.
  const suggestedParts = hint[1].split(".");
  const suggested = suggestedParts[suggestedParts.length - 1] ?? "";
  if (!suggested) return null;

  // Guard: only act on a pure case-folding mismatch.
  if (wrong.toLowerCase() !== suggested.toLowerCase()) return null;

  const quoted = quoteIdentifier(suggested);
  // Nothing to fix if the real name is already a plain lowercase identifier.
  if (quoted === suggested) return null;

  const rewritten = replaceUnquotedIdentifier(sql, suggested, quoted);
  return rewritten === sql ? null : rewritten;
}

export function connectionDisplayName(
  draft: Pick<ConnectionDraft, "database" | "engine" | "host" | "port">,
) {
  return `${draft.database} (${connectionEngineLabel(draft.engine)} ${draft.host}:${draft.port})`;
}

function parseDatabaseObjectId(objectId: string) {
  const [, qualifiedName] = objectId.split(":");
  const [schemaName, objectName] = qualifiedName?.split(".") ?? [];

  if (!schemaName || !objectName) return null;

  return {
    name: objectName,
    qualifiedName: `${schemaName}.${objectName}`,
    schema: schemaName,
  };
}

export function buildDefaultObjectSql(objectId: string, limit: number, engine: DatabaseEngine) {
  const object = parseDatabaseObjectId(objectId);
  // Quote the identifier so mixed-case names are not folded to lowercase by the server.
  const target = object ? qualifyName(object.schema, object.name) : null;
  // SQL Server uses `TOP n` instead of a trailing `LIMIT n`.
  if (engine === "mssql") {
    return target ? `SELECT TOP ${limit} * FROM ${target};` : `SELECT TOP ${limit} *;`;
  }
  return target ? `SELECT * FROM ${target} LIMIT ${limit};` : `SELECT * LIMIT ${limit};`;
}

export function buildObjectTabLabel(objectId: string) {
  return parseDatabaseObjectId(objectId)?.qualifiedName ?? objectId;
}

/** Trims surrounding whitespace and a single trailing semicolon so the SQL can be
 * safely embedded as a subquery for pagination. */
export function normalizeBaseSql(sql: string): string {
  return sql.trim().replace(/;\s*$/, "");
}

/** Read queries (SELECT / WITH) are the ones we paginate by wrapping in a subquery. */
export function isReadQuery(sql: string): boolean {
  return /^(select|with)\b/i.test(normalizeBaseSql(sql));
}

/**
 * Detects a trailing `LIMIT n` (optionally followed by `OFFSET m`) and returns the
 * limit value plus the query with that clause removed. Used so the user's own LIMIT
 * becomes the pagination page size while we still page over the full result set.
 * Returns `null` when there's no trailing limit (e.g. a `LIMIT` only in a subquery).
 */
export function parseTrailingLimit(
  sql: string,
  engine: DatabaseEngine,
): { pageSize: number; baseSql: string } | null {
  // SQL Server has no trailing `LIMIT`; its paging uses OFFSET/FETCH, so there's
  // nothing to strip here.
  if (engine === "mssql") return null;
  const normalized = normalizeBaseSql(sql);
  const match = normalized.match(/\s+limit\s+(\d+)\s*(?:offset\s+\d+\s*)?$/i);
  if (!match || match.index === undefined) return null;

  const pageSize = Number(match[1]);
  if (!Number.isFinite(pageSize) || pageSize <= 0) return null;

  return { pageSize, baseSql: normalized.slice(0, match.index).trimEnd() };
}

/**
 * Wraps a read query as a subquery and applies SQL-level pagination via
 * `LIMIT`/`OFFSET` so each page is fetched from the database (no JS slicing).
 * `baseSql` must already be normalized (see {@link normalizeBaseSql}).
 *
 * Note: an `ORDER BY` inside `baseSql` is preserved by PostgreSQL in practice
 * but is not guaranteed by the SQL standard for subqueries — accepted limitation.
 */
export function buildPageSql(
  baseSql: string,
  pageSize: number,
  page: number,
  engine: DatabaseEngine,
): string {
  const offset = page * pageSize;
  // SQL Server requires an ORDER BY for OFFSET/FETCH; `ORDER BY (SELECT NULL)`
  // satisfies it without imposing a real sort key.
  if (engine === "mssql") {
    return `SELECT * FROM (${baseSql}) AS _databara_q ORDER BY (SELECT NULL) OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`;
  }
  return `SELECT * FROM (${baseSql}) AS _databara_q LIMIT ${pageSize} OFFSET ${offset}`;
}

/** Total row count for the wrapped read query, used to compute the page count. */
export function buildCountSql(baseSql: string): string {
  return `SELECT count(*) AS total FROM (${baseSql}) AS _databara_q`;
}

/** Human-friendly status message for a non-read statement (DELETE/UPDATE/CREATE…). */
export function formatCommandMessage(
  commandTag: string | null,
  rowsAffected: number | null,
  durationMs: number,
): string {
  const tag = commandTag ?? translate("results.ok");
  const affected =
    rowsAffected != null ? ` · ${translate("results.rowsAffected", { count: rowsAffected })}` : "";
  return `${tag}${affected} · ${durationMs} ms`;
}

export async function copyText(text: string) {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  document.body.append(textArea);
  textArea.select();
  document.execCommand("copy");
  textArea.remove();
}
