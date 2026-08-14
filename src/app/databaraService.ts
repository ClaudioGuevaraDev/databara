import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  defaultDatabaseEngine,
  ensureSupportedConnectionEngine,
  isFileEngine,
  normalizeDatabaseEngine,
} from "./connectionEngines";
import type {
  BackupProgress,
  ColumnTypeCategory,
  ConnectionDraft,
  ConnectionProfile,
  ConnectionTestResult,
  DatabaseEngine,
  DatabaseObjectDetails,
  DatabaseTreeNode,
  Language,
  NotificationPosition,
  SslMode,
  ThemePreference,
} from "./types";

export type StoredConnectionDraft = Omit<ConnectionDraft, "password">;

type BackendConnectionDraft = ConnectionDraft;

type BackendConnectionProfile = Omit<ConnectionProfile, "engine"> & {
  engine: DatabaseEngine | "PostgreSQL";
};

type BackendDatabaseObjectDetails = Omit<DatabaseObjectDetails, "engine"> & {
  engine: DatabaseEngine | "PostgreSQL";
};

type BackendConnectResult = Omit<ConnectResult, "connection" | "tree"> & {
  connection: BackendConnectionProfile;
  tree: DatabaseTreeNode[];
};

export type ConnectResult = {
  connection: ConnectionProfile;
  tree: DatabaseTreeNode[];
  selectedObjectId: string | null;
  selectedObject: DatabaseObjectDetails | null;
};

const legacyStoredConnectionKey = "databara.postgres.connection";
const legacyStoredConnectionsKey = "databara.postgres.connections";
const storedConnectionsKey = "databara.connections.v1";

const settingsStorageKey = "databara.settings.v1";

// Custom display names for server groups, keyed by server node id
// (`server:<engine>:<host>:<port>`). Absent entry → fall back to `host:port`.
const serverLabelsKey = "databara.serverLabels.v1";

// One-time flag set by a configuration import that bundled plaintext passwords.
// The next startup honors it to auto-connect every saved connection once (even
// when "keep connections active" is off), then clears it so later startups
// revert to the native behavior. Deliberately excluded from exports.
const importAutoConnectKey = "databara.import.autoConnect.v1";

export type AppSettings = {
  zoom: { level: number };
  // When enabled, connection passwords are stored in the OS keychain so
  // connections reconnect on startup without prompting.
  keepConnectionsActive: { enabled: boolean };
  // When enabled, connecting to a database also connects (in the background) to
  // the other already-saved databases on the same server.
  activateSiblingConnections: { enabled: boolean };
  // When enabled, connecting to a database discovers the other databases on the
  // same server and lists them in the sidebar (without connecting them).
  discoverServerDatabases: { enabled: boolean };
  // When enabled, exporting the configuration includes connection passwords (read
  // from the OS keychain) in plaintext in the downloaded file. Off by default.
  exportIncludesPasswords: { enabled: boolean };
  // Font size (in px) of the Monaco SQL editor.
  editorFontSize: { size: number };
  // On-screen corner/edge where toast notifications appear.
  notificationPosition: { position: NotificationPosition };
  // Width (in px) of the explorer sidebar.
  sidebarWidth: { width: number };
  // Height (in px) of the bottom results panel.
  bottomPanelHeight: { height: number };
  // Language code for the interface.
  language: { code: Language };
  // Application color theme (dark / light / follow the OS).
  theme: { preference: ThemePreference };
};

export const SUPPORTED_LANGUAGES: readonly Language[] = [
  "en",
  "es",
  "fr",
  "de",
  "pt-BR",
  "it",
  "zh-CN",
  "ja",
  "ru",
];

export const THEME_PREFERENCES: readonly ThemePreference[] = ["dark", "light", "system"];

export const NOTIFICATION_POSITIONS: readonly NotificationPosition[] = [
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

// Zoom level is stored as a percent integer (100 = normal, no scaling). CSS
// `zoom` receives level / 100.
export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;
export const ZOOM_STEP = 10;

// SQL editor font size, in px.
export const EDITOR_FONT_SIZE_MIN = 8;
export const EDITOR_FONT_SIZE_MAX = 24;
export const EDITOR_FONT_SIZE_STEP = 1;

// Explorer sidebar width, in px.
export const SIDEBAR_WIDTH_MIN = 200;
export const SIDEBAR_WIDTH_MAX = 600;
export const SIDEBAR_WIDTH_STEP = 1;
export const SIDEBAR_WIDTH_DEFAULT = 320;

// Bottom results panel height, in px.
export const BOTTOM_PANEL_HEIGHT_MIN = 160;
export const BOTTOM_PANEL_HEIGHT_MAX = 800;
export const BOTTOM_PANEL_HEIGHT_STEP = 1;
export const BOTTOM_PANEL_HEIGHT_DEFAULT = 360;

export const defaultAppSettings: AppSettings = {
  zoom: { level: 100 },
  keepConnectionsActive: { enabled: false },
  activateSiblingConnections: { enabled: false },
  discoverServerDatabases: { enabled: false },
  exportIncludesPasswords: { enabled: false },
  editorFontSize: { size: 13 },
  notificationPosition: { position: "top-center" },
  sidebarWidth: { width: SIDEBAR_WIDTH_DEFAULT },
  bottomPanelHeight: { height: BOTTOM_PANEL_HEIGHT_DEFAULT },
  language: { code: "en" },
  theme: { preference: "dark" },
};

export function clampZoomLevel(level: number): number {
  if (!Number.isFinite(level)) return defaultAppSettings.zoom.level;
  const snapped = Math.round(level / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, snapped));
}

export function clampEditorFontSize(size: number): number {
  if (!Number.isFinite(size)) return defaultAppSettings.editorFontSize.size;
  const snapped = Math.round(size);
  return Math.min(EDITOR_FONT_SIZE_MAX, Math.max(EDITOR_FONT_SIZE_MIN, snapped));
}

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return defaultAppSettings.sidebarWidth.width;
  const snapped = Math.round(width);
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, snapped));
}

export function clampBottomPanelHeight(height: number): number {
  if (!Number.isFinite(height)) return defaultAppSettings.bottomPanelHeight.height;
  const snapped = Math.round(height);
  return Math.min(BOTTOM_PANEL_HEIGHT_MAX, Math.max(BOTTOM_PANEL_HEIGHT_MIN, snapped));
}

// Reads a `{ enabled: boolean }` setting from raw localStorage, falling back to
// the provided default when missing or malformed.
function normalizeEnabledFlag(raw: unknown, key: string, fallback: boolean): { enabled: boolean } {
  const entry = (raw as Record<string, unknown>)[key];
  const enabled =
    entry && typeof entry === "object" ? (entry as { enabled?: unknown }).enabled : undefined;
  return { enabled: typeof enabled === "boolean" ? enabled : fallback };
}

function normalizeAppSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== "object") return defaultAppSettings;
  const zoom = (raw as { zoom?: unknown }).zoom;
  const level = zoom && typeof zoom === "object" ? (zoom as { level?: unknown }).level : undefined;
  const editorFontSize = (raw as { editorFontSize?: unknown }).editorFontSize;
  const size =
    editorFontSize && typeof editorFontSize === "object"
      ? (editorFontSize as { size?: unknown }).size
      : undefined;
  const notificationPosition = (raw as { notificationPosition?: unknown }).notificationPosition;
  const position =
    notificationPosition && typeof notificationPosition === "object"
      ? (notificationPosition as { position?: unknown }).position
      : undefined;
  const sidebarWidth = (raw as { sidebarWidth?: unknown }).sidebarWidth;
  const width =
    sidebarWidth && typeof sidebarWidth === "object"
      ? (sidebarWidth as { width?: unknown }).width
      : undefined;
  const bottomPanelHeight = (raw as { bottomPanelHeight?: unknown }).bottomPanelHeight;
  const height =
    bottomPanelHeight && typeof bottomPanelHeight === "object"
      ? (bottomPanelHeight as { height?: unknown }).height
      : undefined;
  const language = (raw as { language?: unknown }).language;
  const code =
    language && typeof language === "object" ? (language as { code?: unknown }).code : undefined;
  const theme = (raw as { theme?: unknown }).theme;
  const preference =
    theme && typeof theme === "object" ? (theme as { preference?: unknown }).preference : undefined;
  return {
    zoom: {
      level: clampZoomLevel(typeof level === "number" ? level : defaultAppSettings.zoom.level),
    },
    keepConnectionsActive: normalizeEnabledFlag(
      raw,
      "keepConnectionsActive",
      defaultAppSettings.keepConnectionsActive.enabled,
    ),
    activateSiblingConnections: normalizeEnabledFlag(
      raw,
      "activateSiblingConnections",
      defaultAppSettings.activateSiblingConnections.enabled,
    ),
    discoverServerDatabases: normalizeEnabledFlag(
      raw,
      "discoverServerDatabases",
      defaultAppSettings.discoverServerDatabases.enabled,
    ),
    exportIncludesPasswords: normalizeEnabledFlag(
      raw,
      "exportIncludesPasswords",
      defaultAppSettings.exportIncludesPasswords.enabled,
    ),
    editorFontSize: {
      size: clampEditorFontSize(
        typeof size === "number" ? size : defaultAppSettings.editorFontSize.size,
      ),
    },
    notificationPosition: {
      position: NOTIFICATION_POSITIONS.includes(position as NotificationPosition)
        ? (position as NotificationPosition)
        : defaultAppSettings.notificationPosition.position,
    },
    sidebarWidth: {
      width: clampSidebarWidth(
        typeof width === "number" ? width : defaultAppSettings.sidebarWidth.width,
      ),
    },
    bottomPanelHeight: {
      height: clampBottomPanelHeight(
        typeof height === "number" ? height : defaultAppSettings.bottomPanelHeight.height,
      ),
    },
    language: {
      code: SUPPORTED_LANGUAGES.includes(code as Language)
        ? (code as Language)
        : defaultAppSettings.language.code,
    },
    theme: {
      preference: THEME_PREFERENCES.includes(preference as ThemePreference)
        ? (preference as ThemePreference)
        : defaultAppSettings.theme.preference,
    },
  };
}

export function loadAppSettings(): AppSettings {
  const raw = window.localStorage.getItem(settingsStorageKey);
  if (!raw) return defaultAppSettings;
  try {
    return normalizeAppSettings(JSON.parse(raw));
  } catch {
    window.localStorage.removeItem(settingsStorageKey);
    return defaultAppSettings;
  }
}

export function saveAppSettings(settings: AppSettings): void {
  window.localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
}

export function loadServerLabels(): Record<string, string> {
  const raw = window.localStorage.getItem(serverLabelsKey);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    );
    return Object.fromEntries(entries);
  } catch {
    window.localStorage.removeItem(serverLabelsKey);
    return {};
  }
}

function saveServerLabels(labels: Record<string, string>): void {
  window.localStorage.setItem(serverLabelsKey, JSON.stringify(labels));
}

// Trims the name; an empty name removes the custom label (reverts to host:port).
export function saveServerLabel(serverId: string, name: string): Record<string, string> {
  const labels = loadServerLabels();
  const trimmed = name.trim();
  if (trimmed) labels[serverId] = trimmed;
  else delete labels[serverId];
  saveServerLabels(labels);
  return labels;
}

export function deleteServerLabel(serverId: string): Record<string, string> {
  const labels = loadServerLabels();
  delete labels[serverId];
  saveServerLabels(labels);
  return labels;
}

// Every localStorage key the app owns is namespaced under this prefix. Used to
// measure and export the app's local footprint without touching unrelated keys.
const STORAGE_PREFIX = "databara.";

export type StorageCategoryId = "connections" | "settings" | "serverLabels" | "sqlTabs" | "other";

export type StorageCategory = { id: StorageCategoryId; bytes: number; entries: number };
export type StorageReport = { categories: StorageCategory[]; totalBytes: number };

// Classifies a `databara.*` localStorage key into one of the report categories.
function storageCategoryFor(key: string): StorageCategoryId {
  if (
    key === storedConnectionsKey ||
    key === legacyStoredConnectionsKey ||
    key === legacyStoredConnectionKey
  )
    return "connections";
  if (key === settingsStorageKey) return "settings";
  if (key === serverLabelsKey) return "serverLabels";
  if (key.startsWith("databara.sqlTabs.v1")) return "sqlTabs";
  return "other";
}

// Sums the byte size of the app's localStorage entries, grouped by category.
// Sizes use UTF-8 byte length (key + value) for an honest on-disk estimate.
export function getStorageReport(): StorageReport {
  const totals = new Map<StorageCategoryId, { bytes: number; entries: number }>();
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
    const value = window.localStorage.getItem(key) ?? "";
    const bytes = new Blob([key, value]).size;
    const category = storageCategoryFor(key);
    const current = totals.get(category) ?? { bytes: 0, entries: 0 };
    current.bytes += bytes;
    current.entries += 1;
    totals.set(category, current);
  }
  const order: StorageCategoryId[] = [
    "connections",
    "settings",
    "serverLabels",
    "sqlTabs",
    "other",
  ];
  const categories = order
    .map((id) => ({ id, ...(totals.get(id) ?? { bytes: 0, entries: 0 }) }))
    .filter((category) => category.entries > 0);
  const totalBytes = categories.reduce((sum, category) => sum + category.bytes, 0);
  return { categories, totalBytes };
}

// Origin storage usage/quota as reported by the browser/WebView (the headline
// "used of total" figure). Returns null when the API is unavailable.
export async function getBrowserStorageEstimate(): Promise<{
  usage: number;
  quota: number;
} | null> {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (typeof usage !== "number" || typeof quota !== "number") return null;
    return { usage, quota };
  } catch {
    return null;
  }
}

// The keychain account key for a stored connection. Mirrors `connectionKey` in
// workspaceContext.utils.ts (kept inline so the data layer has no upward import).
function connectionAccountKey(connection: StoredConnectionDraft): string {
  return `${connection.engine}:${connection.host}:${connection.port}:${connection.database}:${connection.user}`;
}

export type ConfigurationExport = {
  app: "Databara";
  schemaVersion: 1;
  exportedAt: string;
  includesPasswords: boolean;
  localStorage: Record<string, unknown>;
  keychain?: Record<string, string>;
  note: string;
};

// Gathers every `databara.*` localStorage entry into a single JSON-serializable
// object. When `includePasswords` is true, collects each saved connection's
// password into a `keychain` map (plaintext — used only when the user explicitly
// opts in): from the OS keychain (populated when "keep connections active" is on)
// merged with `livePasswords` (the in-memory passwords of connections opened this
// session). Passwords are excluded by default.
export async function buildConfigurationExport(options: {
  includePasswords: boolean;
  livePasswords?: Record<string, string>;
}): Promise<ConfigurationExport> {
  const localStorageData: Record<string, unknown> = {};
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
    // Transient one-time flag — never carry it into an export.
    if (key === importAutoConnectKey) continue;
    const value = window.localStorage.getItem(key);
    if (value === null) continue;
    try {
      localStorageData[key] = JSON.parse(value) as unknown;
    } catch {
      localStorageData[key] = value;
    }
  }

  const exported: ConfigurationExport = {
    app: "Databara",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    includesPasswords: options.includePasswords,
    localStorage: localStorageData,
    note: options.includePasswords
      ? "WARNING: this file contains plaintext connection passwords. Keep it private."
      : "Passwords are stored in the OS keychain and are intentionally excluded from this export.",
  };

  if (options.includePasswords) {
    const keychain: Record<string, string> = {};
    for (const connection of loadStoredConnections()) {
      const account = connectionAccountKey(connection);
      const password = await getConnectionPassword(account);
      if (password !== null) keychain[account] = password;
    }
    // In-memory passwords from this session fill in (and take precedence over)
    // any keychain entries, so passwords are exported even when "keep connections
    // active" is off and nothing was persisted to the keychain.
    Object.assign(keychain, options.livePasswords ?? {});
    exported.keychain = keychain;
  }

  return exported;
}

// A short, human-facing summary of an import file, shown in the load dialog so
// the user can confirm what they are about to restore.
export type ConfigurationImportSummary = {
  connectionCount: number;
  includesPasswords: boolean;
  exportedAt: string;
};

// Parses and validates the text of a configuration file produced by
// buildConfigurationExport. Throws with a clear message if the payload is not a
// Databara export of a supported schema version.
export function parseConfigurationImport(text: string): ConfigurationExport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return throwInvalidConfig();
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as ConfigurationExport).app !== "Databara" ||
    (parsed as ConfigurationExport).schemaVersion !== 1 ||
    typeof (parsed as ConfigurationExport).localStorage !== "object" ||
    (parsed as ConfigurationExport).localStorage === null
  ) {
    return throwInvalidConfig();
  }
  return parsed as ConfigurationExport;
}

function throwInvalidConfig(): never {
  throw new Error("This file is not a valid Databara configuration export.");
}

// Derives the load-dialog summary from a parsed configuration export.
export function summarizeConfigurationImport(
  config: ConfigurationExport,
): ConfigurationImportSummary {
  const connections = config.localStorage[storedConnectionsKey];
  return {
    connectionCount: Array.isArray(connections) ? connections.length : 0,
    includesPasswords: Boolean(config.includesPasswords && config.keychain),
    exportedAt: config.exportedAt,
  };
}

// Restores (replaces) the app's local state from a configuration export: clears
// every `databara.*` localStorage key, writes the entries from the file, and
// repopulates the OS keychain with any bundled passwords. The caller is expected
// to reload the window afterwards so React state re-reads the new localStorage.
export async function applyConfigurationImport(config: ConfigurationExport): Promise<void> {
  const staleKeys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key && key.startsWith(STORAGE_PREFIX)) staleKeys.push(key);
  }
  staleKeys.forEach((key) => window.localStorage.removeItem(key));

  for (const [key, value] of Object.entries(config.localStorage)) {
    if (!key.startsWith(STORAGE_PREFIX)) continue;
    window.localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  }

  if (config.keychain && Object.keys(config.keychain).length > 0) {
    for (const [account, password] of Object.entries(config.keychain)) {
      await storeConnectionPassword(account, password);
    }
    // The file bundled passwords: auto-connect every saved connection once on the
    // next startup, regardless of the (imported) "keep connections active" setting.
    markImportAutoConnect();
  }
}

// One-time "auto-connect after import" flag helpers. Set when applying a config
// import that bundled passwords; read once and cleared on the next startup so the
// auto-connect happens exactly once.
export function markImportAutoConnect(): void {
  window.localStorage.setItem(importAutoConnectKey, "1");
}

export function readImportAutoConnectFlag(): boolean {
  return window.localStorage.getItem(importAutoConnectKey) === "1";
}

export function clearImportAutoConnectFlag(): void {
  window.localStorage.removeItem(importAutoConnectKey);
}

// Whether this install can apply an in-app update. False for Linux .deb/.rpm
// installs (only an AppImage can self-update). Assume true outside Tauri.
export async function updatesSupported(): Promise<boolean> {
  if (!("__TAURI_INTERNALS__" in window)) return true;
  return invoke<boolean>("updates_supported");
}

// Connection passwords are stored in the OS keychain (never localStorage),
// keyed by the connection key. These no-op / return null outside the Tauri
// runtime (e.g. `pnpm run dev` in a browser).
export async function storeConnectionPassword(account: string, password: string): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  return invoke<void>("store_connection_password", { account, password });
}

export async function getConnectionPassword(account: string): Promise<string | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  return invoke<string | null>("get_connection_password", { account });
}

export async function deleteConnectionPassword(account: string): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  return invoke<void>("delete_connection_password", { account });
}

export async function testPostgresConnection(
  draft: ConnectionDraft,
): Promise<ConnectionTestResult> {
  ensureSupportedConnectionEngine(draft);
  return invoke<ConnectionTestResult>("test_postgres_connection", { draft: toBackendDraft(draft) });
}

export async function connectPostgres(draft: ConnectionDraft): Promise<ConnectResult> {
  ensureSupportedConnectionEngine(draft);
  const result = await invoke<BackendConnectResult>("connect_postgres", {
    draft: toBackendDraft(draft),
  });
  const engine = normalizeDatabaseEngine(result.connection.engine);

  return {
    ...result,
    connection: {
      ...result.connection,
      engine,
    },
    tree: normalizeTreeForEngine(result.tree, engine),
  };
}

export async function listPostgresTree(connectionId: string): Promise<DatabaseTreeNode[]> {
  const tree = await invoke<DatabaseTreeNode[]>("list_postgres_tree", { connectionId });
  return normalizeTreeForEngine(tree, defaultDatabaseEngine);
}

export async function getPostgresObjectDetails(
  connectionId: string,
  objectId: string,
): Promise<DatabaseObjectDetails> {
  const details = await invoke<BackendDatabaseObjectDetails>("get_postgres_object_details", {
    connectionId,
    objectId,
  });
  return {
    ...details,
    engine: normalizeDatabaseEngine(details.engine),
  };
}

export type QueryExecutionResult = {
  columns: string[];
  columnTypes: ColumnTypeCategory[];
  rows: (string | null)[][];
  rowCount: number;
  durationMs: number;
  rowsAffected: number | null;
  commandTag: string | null;
};

export async function runPostgresQuery(
  connectionId: string,
  sql: string,
): Promise<QueryExecutionResult> {
  return invoke<QueryExecutionResult>("run_postgres_query", { connectionId, sql });
}

// Opens the native "Save As" dialog so the user picks where the export lands.
// Returns the chosen absolute path, or null if the dialog was cancelled. The
// extension filter is keyed off the export format.
export async function pickSavePath(
  defaultName: string,
  format: "csv" | "json",
): Promise<string | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  const path = await save({
    defaultPath: defaultName,
    filters: [
      {
        name: format === "csv" ? "CSV" : "JSON",
        extensions: [format],
      },
    ],
  });
  return path ?? null;
}

// Writes UTF-8 text to an absolute path (chosen via pickSavePath) through the
// Rust write_text_file command.
export async function writeTextFile(path: string, content: string): Promise<void> {
  return invoke<void>("write_text_file", { path, content });
}

// Opens the native open dialog so the user picks a configuration file to load.
// Returns the chosen absolute path, or null if the dialog was cancelled or we
// are running outside the desktop app.
export async function pickOpenPath(): Promise<string | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  const path = await open({
    multiple: false,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  return typeof path === "string" ? path : null;
}

// Reads UTF-8 text from an absolute path (chosen via pickOpenPath) through the
// Rust read_text_file command.
export async function readTextFile(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}

// Opens the native open dialog so the user picks a SQLite database file. Returns
// the chosen absolute path, or null if cancelled / outside the desktop app.
export async function pickDatabaseFilePath(): Promise<string | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  const path = await open({
    multiple: false,
    filters: [{ name: "SQLite database", extensions: ["db", "sqlite", "sqlite3", "db3"] }],
  });
  return typeof path === "string" ? path : null;
}

// Opens the native folder picker so the user chooses where a backup lands.
// Returns the chosen absolute directory, or null if the dialog was cancelled.
export async function pickDirectory(): Promise<string | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  const directory = await open({ directory: true });
  return typeof directory === "string" ? directory : null;
}

// Streams a full schema + data `.sql` dump of the connected database to
// `directory`/`fileName` (the Rust side appends `.sql` if missing) and returns the
// final path. Progress is reported separately via listenBackupProgress.
export async function backupDatabase(
  connectionId: string,
  directory: string,
  fileName: string,
): Promise<string> {
  return invoke<string>("backup_database", { connectionId, directory, fileName });
}

// Event the backup dialog listens on to render live progress (0–100).
export const BACKUP_PROGRESS_EVENT = "databara://backup-progress";

// Subscribes to backup progress events; returns an unlisten function. No-op
// (returns a noop unlisten) outside the desktop app.
export async function listenBackupProgress(
  onProgress: (progress: BackupProgress) => void,
): Promise<UnlistenFn> {
  if (!("__TAURI_INTERNALS__" in window)) return () => {};
  return listen<BackupProgress>(BACKUP_PROGRESS_EVENT, (event) => onProgress(event.payload));
}

// Catalog query that lists sibling databases on the same server, per engine.
// SQLite is file-based (one file = one database) so it has no siblings → null.
function serverDatabaseListSql(engine: DatabaseEngine): string | null {
  switch (engine) {
    case "postgresql":
      return "SELECT datname FROM pg_database WHERE datistemplate = false AND datallowconn = true AND datname <> current_database() ORDER BY datname";
    case "mysql":
    case "mariadb":
      return "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('mysql','information_schema','performance_schema','sys') AND schema_name <> database() ORDER BY schema_name";
    case "mssql":
      return "SELECT name FROM sys.databases WHERE database_id > 4 AND name <> DB_NAME() ORDER BY name";
    case "sqlite":
    default:
      return null;
  }
}

// Lists the other (connectable) databases living on the same server as the given
// live connection, excluding the one it is connected to. Returns [] for engines
// without a sibling-database concept (SQLite).
export async function fetchServerDatabaseNames(
  connectionId: string,
  engine: DatabaseEngine,
): Promise<string[]> {
  const sql = serverDatabaseListSql(engine);
  if (!sql) return [];
  const result = await runPostgresQuery(connectionId, sql);
  return result.rows.map((row) => row[0]).filter((value): value is string => value !== null);
}

export async function setUnsavedSqlTabs(hasUnsaved: boolean): Promise<void> {
  return invoke<void>("set_unsaved_sql_tabs", { hasUnsaved });
}

export async function closeMainWindowAfterUnsavedResolution(): Promise<void> {
  return invoke<void>("close_main_window_after_unsaved_resolution");
}

// Closes the splash window and reveals the (initially hidden) main window. Called
// once the frontend has finished its startup work. No-op outside the desktop app
// (e.g. `pnpm run dev` in a browser, where there is no splash/main window).
export async function completeStartup(): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  return invoke<void>("complete_startup");
}

// Event the splash window listens on to render real startup progress (0–100).
export const STARTUP_PROGRESS_EVENT = "databara://startup-progress";

// Broadcasts the current startup progress percentage to the splash window.
// No-op outside the desktop app.
export async function emitStartupProgress(percent: number): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return emit(STARTUP_PROGRESS_EVENT, { percent: clamped });
}

export function loadStoredConnections(): StoredConnectionDraft[] {
  const rawConnections = window.localStorage.getItem(storedConnectionsKey);

  if (rawConnections) {
    try {
      const connections = JSON.parse(rawConnections) as unknown[];
      return Array.isArray(connections)
        ? connections.flatMap((connection) => {
            const normalized = normalizeStoredConnection(connection);
            return normalized ? [normalized] : [];
          })
        : [];
    } catch {
      window.localStorage.removeItem(storedConnectionsKey);
    }
  }

  const rawLegacyConnections = window.localStorage.getItem(legacyStoredConnectionsKey);
  if (rawLegacyConnections) {
    try {
      const connections = JSON.parse(rawLegacyConnections) as unknown[];
      const normalizedConnections = Array.isArray(connections)
        ? connections.flatMap((connection) => {
            const normalized = normalizeStoredConnection(connection);
            return normalized ? [normalized] : [];
          })
        : [];
      saveStoredConnections(normalizedConnections);
      window.localStorage.removeItem(legacyStoredConnectionsKey);
      return normalizedConnections;
    } catch {
      window.localStorage.removeItem(legacyStoredConnectionsKey);
    }
  }

  const rawLegacyConnection = window.localStorage.getItem(legacyStoredConnectionKey);
  if (!rawLegacyConnection) return [];

  try {
    const legacyConnection = normalizeStoredConnection(JSON.parse(rawLegacyConnection));
    if (!legacyConnection) {
      window.localStorage.removeItem(legacyStoredConnectionKey);
      return [];
    }
    saveStoredConnections([legacyConnection]);
    window.localStorage.removeItem(legacyStoredConnectionKey);
    return [legacyConnection];
  } catch {
    window.localStorage.removeItem(legacyStoredConnectionKey);
    return [];
  }
}

export function saveStoredConnection(draft: ConnectionDraft): StoredConnectionDraft[] {
  const storedDraft: StoredConnectionDraft = {
    engine: draft.engine,
    name: draft.name,
    host: draft.host,
    port: draft.port,
    database: draft.database,
    user: draft.user,
    sslMode: draft.sslMode,
  };

  const savedConnections = loadStoredConnections();
  const existingIndex = savedConnections.findIndex(
    (connection) =>
      connection.engine === storedDraft.engine &&
      connection.host === storedDraft.host &&
      connection.port === storedDraft.port &&
      connection.database === storedDraft.database &&
      connection.user === storedDraft.user,
  );

  // Preserve creation order: update an existing connection in place (keeps its
  // position) and append brand-new ones at the end. The sidebar order must never
  // shift on connect/reconnect/save.
  const nextConnections =
    existingIndex === -1
      ? [...savedConnections, storedDraft]
      : savedConnections.map((connection, index) =>
          index === existingIndex ? storedDraft : connection,
        );

  saveStoredConnections(nextConnections);
  return nextConnections;
}

export function deleteStoredConnection(connectionToDelete: StoredConnectionDraft) {
  const nextConnections = loadStoredConnections().filter(
    (connection) =>
      !(
        connection.engine === connectionToDelete.engine &&
        connection.host === connectionToDelete.host &&
        connection.port === connectionToDelete.port &&
        connection.database === connectionToDelete.database &&
        connection.user === connectionToDelete.user
      ),
  );

  saveStoredConnections(nextConnections);
  return nextConnections;
}

function saveStoredConnections(connections: StoredConnectionDraft[]) {
  window.localStorage.setItem(storedConnectionsKey, JSON.stringify(connections));
}

// The backend now dispatches on `engine`, so (unlike before) we forward it along
// with the engine-specific fields (`filePath` for SQLite, `trustServerCert` for
// SQL Server). The Rust `ConnectionDraft` treats the fields it doesn't need as
// optional, so a full draft is safe to send for every engine.
function toBackendDraft(draft: ConnectionDraft): BackendConnectionDraft {
  return { ...draft };
}

// Every engine's `list_tree` returns a single server node at the root
// (`server:{host}:{port}`), so only the top level needs the engine spliced into
// its id. Recursing used to deep-copy the whole tree — thousands of objects per
// connect and per refresh — while rewriting nothing below the root. Keeping the
// subtrees by reference also preserves node identity across refreshes, which the
// explorer's memoized flattening benefits from.
function normalizeTreeForEngine(
  tree: DatabaseTreeNode[],
  engine: DatabaseEngine,
): DatabaseTreeNode[] {
  return tree.map((node) =>
    node.id.startsWith("server:") ? { ...node, id: `server:${engine}:${node.id.slice(7)}` } : node,
  );
}

function normalizeStoredConnection(connection: unknown): StoredConnectionDraft | null {
  if (!connection || typeof connection !== "object") return null;

  const candidate = connection as Partial<StoredConnectionDraft> & {
    sslMode?: SslMode;
  };
  if (typeof candidate.name !== "string") return null;

  const engine = normalizeDatabaseEngine(candidate.engine);

  // File engines (SQLite) have no host/port/user; they're identified by a path.
  // `host` carries the path (identity) and `database` the file name (tree label),
  // mirroring what the connection form and the Rust profile builder produce.
  if (isFileEngine(engine)) {
    if (typeof candidate.filePath !== "string" || candidate.filePath.trim() === "") {
      return null;
    }
    const filePath = candidate.filePath;
    return {
      database: filePath.split(/[\\/]/).pop() || filePath,
      engine,
      filePath,
      host: filePath,
      name: candidate.name,
      port: 0,
      sslMode: "Disable",
      user: "",
    };
  }

  if (
    typeof candidate.host !== "string" ||
    typeof candidate.port !== "number" ||
    typeof candidate.database !== "string" ||
    typeof candidate.user !== "string"
  ) {
    return null;
  }

  return {
    database: candidate.database,
    engine,
    host: candidate.host,
    name: candidate.name,
    port: candidate.port,
    sslMode: candidate.sslMode ?? "Prefer",
    user: candidate.user,
    ...(typeof candidate.trustServerCert === "boolean"
      ? { trustServerCert: candidate.trustServerCert }
      : {}),
  };
}
