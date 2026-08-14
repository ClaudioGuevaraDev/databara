export type ConnectionStatus = "connected" | "disconnected";
export type DatabaseEngine = "postgresql" | "mysql" | "mariadb" | "sqlite" | "mssql";
export type DatabaseObjectKind = "database" | "schema" | "table" | "view";
export type ResultPanelTab = "results" | "columns" | "schema";
export type ResultViewMode = "table" | "json";
export type ResultExportFormat = "csv" | "json";
export type ResultExportScope = "page" | "all";
export type QueryState = "idle" | "running" | "success" | "error" | "cancelled";
export type SslMode = "Prefer" | "Require" | "Disable";

export type ConnectionProfile = {
  id: string;
  name: string;
  engine: DatabaseEngine;
  engineVersion: string;
  host: string;
  port: number;
  database: string;
  user: string;
  status: ConnectionStatus;
  latencyMs: number;
  defaultSchema: string;
  sslMode: SslMode;
  // SQLite only: absolute path to the database file (host/port/user are unused).
  filePath?: string;
  // SQL Server only: trust a self-signed server certificate (common in dev).
  trustServerCert?: boolean;
};

export type DatabaseTreeNode = {
  id: string;
  label: string;
  kind: DatabaseObjectKind;
  open?: boolean;
  children?: DatabaseTreeNode[];
};

export type ColumnDefinition = {
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey?: boolean;
  indexed?: boolean;
};

export type IndexDefinition = {
  name: string;
  columns: string[];
  unique?: boolean;
  primary?: boolean;
};

export type DatabaseObjectDetails = {
  id: string;
  name: string;
  schema: string;
  kind: Extract<DatabaseObjectKind, "table" | "view">;
  engine: ConnectionProfile["engine"];
  rowCount: number;
  safeEdit: boolean;
  columns: ColumnDefinition[];
  indexes: IndexDefinition[];
};

export type SqlTab = {
  id: string;
  label: string;
  sql: string;
  savedSql?: string;
  dirty: boolean;
  state: "temporary" | "official";
  objectId?: string;
  connectionKey?: string;
};

export type ColumnTypeCategory = "number" | "boolean" | "json" | "string";

export type QueryResult = {
  id: string;
  sql: string;
  columns: string[];
  columnTypes: ColumnTypeCategory[];
  rows: (string | null)[][];
  durationMs: number;
  rowCount: number;
  message: string;
};

export type UpdatePhase =
  | "checking"
  | "downloading"
  | "installing"
  | "done"
  | "error"
  | "unavailable";

export type UpdateProgress = {
  phase: UpdatePhase;
  downloaded: number;
  total: number;
  version?: string;
  notes?: string;
  error?: string;
};

export type BackupProgress = {
  percent: number;
  table: string;
};

export type ToastTone = "default" | "success" | "warning";

export type Toast = {
  id: number;
  text: string;
  tone: ToastTone;
};

// Supported UI languages. English is the default; the union grows as more
// locales are added to the i18n catalog.
export type Language = "en" | "es" | "fr" | "de" | "pt-BR" | "it" | "zh-CN" | "ja" | "ru";

export type NotificationPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

// Application color theme. "system" follows the OS `prefers-color-scheme`.
export type ThemePreference = "dark" | "light" | "system";

export const QUERY_PAGE_SIZES = [50, 100, 200, 500] as const;

export type QueryPagination = {
  page: number; // 0-based
  pageSize: number;
  // null while the COUNT that produces the exact total is still running: the rows
  // of the first page are rendered without waiting for it.
  totalRows: number | null;
  // true when the page size comes from the user's own LIMIT (selector is locked)
  pageSizeLocked: boolean;
};

export type ConnectionDraft = {
  engine: DatabaseEngine;
  name: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  sslMode: SslMode;
  // SQLite only: absolute path to the database file.
  filePath?: string;
  // SQL Server only: trust a self-signed server certificate.
  trustServerCert?: boolean;
};

export type ConnectionTestResult = {
  ok: boolean;
  latencyMs: number;
  message: string;
};
