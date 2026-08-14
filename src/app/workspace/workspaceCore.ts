import { createContext, use } from "react";
import type { AppSettings, ConfigurationExport, StoredConnectionDraft } from "../databaraService";
import { translate } from "../i18n/translate";
import type {
  ColumnDefinition,
  ConnectionDraft,
  ConnectionProfile,
  DatabaseObjectDetails,
  DatabaseTreeNode,
  Language,
  NotificationPosition,
  ThemePreference,
  QueryPagination,
  QueryState,
  QueryResult,
  ResultExportFormat,
  ResultExportScope,
  ResultPanelTab,
  ResultViewMode,
  SqlTab,
  Toast,
  ToastTone,
  UpdateProgress,
} from "../types";

export type RenameServerRequest = {
  serverId: string;
  host: string;
  port: number;
  currentName: string;
};

export type DeleteServerRequest = {
  serverId: string;
  host: string;
  port: number;
  connections: StoredConnectionDraft[];
};

export type AddDatabaseRequest = {
  serverId: string;
  host: string;
  port: number;
  // True when no password is in the keychain for this server, so the modal must
  // also prompt for the password (not just the database name).
  needsPassword: boolean;
};

export type BackupRequest = {
  connectionKey: string;
  databaseName: string;
  defaultFileName: string;
};

export type SettingsTab = "general" | "editor" | "connections" | "storage";

export type WorkspaceState = {
  activeConnection: ConnectionProfile | null;
  activeTab: SqlTab | null;
  activeTabId: string;
  toggledNodes: Set<string>;
  explorerFilter: string;
  completionObject: DatabaseObjectDetails | null;
  connections: ConnectionProfile[];
  addDatabaseRequest: AddDatabaseRequest | null;
  backupRequest: BackupRequest | null;
  deleteConnectionRequest: StoredConnectionDraft | null;
  deleteServerRequest: DeleteServerRequest | null;
  renameServerRequest: RenameServerRequest | null;
  dialogInitialDraft: StoredConnectionDraft | null;
  dialogs: {
    connection: boolean;
    settings: boolean;
    shortcuts: boolean;
    unsavedTabs: boolean;
    loadConfig: boolean;
  };
  passwordConnection: StoredConnectionDraft | null;
  settings: AppSettings;
  settingsTab: SettingsTab;
  queryError: string | null;
  queryPagination: QueryPagination | null;
  queryResult: QueryResult | null;
  queryState: QueryState;
  resultTab: ResultPanelTab;
  resultViewMode: ResultViewMode;
  toast: Toast | null;
  resultsOpen: boolean;
  selectedObject: DatabaseObjectDetails | null;
  selectedObjectId: string;
  sqlTabs: SqlTab[];
  storedConnections: StoredConnectionDraft[];
  updateDialogOpen: boolean;
  updateProgress: UpdateProgress | null;
};

export type WorkspaceActions = {
  closeAddDatabaseDialog: () => void;
  closeDeleteConnectionDialog: () => void;
  closeDeleteServerDialog: () => void;
  closePasswordDialog: () => void;
  closeRenameServerDialog: () => void;
  closeSettingsDialog: () => void;
  openShortcutsDialog: () => void;
  closeShortcutsDialog: () => void;
  openLoadConfigDialog: () => void;
  closeLoadConfigDialog: () => void;
  closeResults: () => void;
  closeSqlTab: (tabId: string) => void;
  officializeSqlTab: (tabId: string) => void;
  closeUnsavedTabsDialog: () => void;
  closeWindowAfterResolution: (mode: "save" | "discard") => Promise<void>;
  confirmAddDatabase: (serverId: string, database: string, password?: string) => Promise<void>;
  confirmDeleteConnection: (connection: StoredConnectionDraft) => void;
  confirmDeleteServer: (serverId: string) => void;
  confirmRenameServer: (serverId: string, name: string) => void;
  confirmObjectTab: (objectId: string, connectionKey?: string) => void;
  connectStoredConnection: (connection: StoredConnectionDraft, password: string) => Promise<void>;
  copyObjectName: () => Promise<void>;
  copySchema: () => Promise<void>;
  copyResult: () => Promise<void>;
  deleteConnection: (nodeId: string) => void;
  openAddDatabase: (serverId: string) => void;
  openDownloadBackup: (connectionKey?: string) => void;
  closeBackupDialog: () => void;
  chooseBackupDirectory: () => Promise<string | null>;
  runBackup: (directory: string, fileName: string) => Promise<void>;
  openDeleteServer: (serverId: string) => void;
  openRenameServer: (serverId: string) => void;
  downloadResults: (format: ResultExportFormat, scope: ResultExportScope) => Promise<void>;
  goToQueryPage: (page: number) => Promise<void>;
  openSchemaTab: () => Promise<void>;
  openNewConnectionDialog: () => void;
  openSavedConnection: (nodeId: string) => void;
  openSettingsDialog: () => void;
  openStorageSettings: () => void;
  previewObject: (objectId?: string) => Promise<void>;
  refreshAll: () => Promise<void>;
  refreshConnection: (connectionKey?: string) => Promise<void>;
  runQuery: () => Promise<void>;
  saveActiveSqlTab: () => Promise<void>;
  saveConnection: (draft: ConnectionDraft) => Promise<void>;
  selectObject: (objectId: string, connectionKey?: string) => void;
  setExplorerFilter: (value: string) => void;
  selectResultTab: (tab: ResultPanelTab) => void;
  selectResultViewMode: (mode: ResultViewMode) => void;
  selectSqlTab: (tabId: string) => void;
  reorderSqlTabs: (tabId: string, toIndex: number) => void;
  setConnectionDialogOpen: (open: boolean) => void;
  setKeepConnectionsActive: (enabled: boolean) => void;
  setSettingsTab: (tab: SettingsTab) => void;
  setActivateSiblingConnections: (enabled: boolean) => void;
  setDiscoverServerDatabases: (enabled: boolean) => void;
  setExportIncludesPasswords: (enabled: boolean) => void;
  exportConfiguration: (includePasswords: boolean) => Promise<ConfigurationExport>;
  notify: (text: string, tone?: ToastTone) => void;
  setEditorFontSize: (size: number) => void;
  setNotificationPosition: (position: NotificationPosition) => void;
  setLanguage: (code: Language) => void;
  setThemePreference: (preference: ThemePreference) => void;
  setSidebarWidth: (width: number) => void;
  setBottomPanelHeight: (height: number) => void;
  resetSettings: () => void;
  resetSettingsKeys: (keys: (keyof AppSettings)[]) => void;
  setQueryPageSize: (pageSize: number) => Promise<void>;
  setZoomLevel: (level: number) => void;
  startUpdateCheck: (opts?: { silent?: boolean }) => Promise<void>;
  dismissUpdateDialog: () => void;
  openDownloadPage: () => void;
  toggleNode: (nodeId: string) => void;
  updateActiveSql: (sql: string) => void;
};

export type WorkspaceMeta = {
  autoReconnecting: boolean;
  connectedConnectionKeys: Set<string>;
  explorerTree: DatabaseTreeNode[];
  hasStoredConnections: boolean;
  hasUnsavedTabs: boolean;
  requiresConnection: boolean;
  selectedConnectionKey: string;
};

export type WorkspaceContextValue = {
  state: WorkspaceState;
  actions: WorkspaceActions;
  meta: WorkspaceMeta;
};

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace() {
  const value = use(WorkspaceContext);
  if (!value) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }

  return value;
}

export function useWorkspaceLayout() {
  const { actions, meta, state } = useWorkspace();
  return {
    activeConnection: state.activeConnection,
    autoReconnecting: meta.autoReconnecting,
    hasStoredConnections: meta.hasStoredConnections,
    openNewConnectionDialog: actions.openNewConnectionDialog,
    openSettingsDialog: actions.openSettingsDialog,
    openShortcutsDialog: actions.openShortcutsDialog,
    openStorageSettings: actions.openStorageSettings,
    openLoadConfigDialog: actions.openLoadConfigDialog,
    requiresConnection: meta.requiresConnection,
    checkForUpdates: actions.startUpdateCheck,
  };
}

export function useSettings() {
  const { actions, state } = useWorkspace();
  return {
    settings: state.settings,
    settingsDialogOpen: state.dialogs.settings,
    settingsTab: state.settingsTab,
    setSettingsTab: actions.setSettingsTab,
    closeSettingsDialog: actions.closeSettingsDialog,
    setKeepConnectionsActive: actions.setKeepConnectionsActive,
    setActivateSiblingConnections: actions.setActivateSiblingConnections,
    setDiscoverServerDatabases: actions.setDiscoverServerDatabases,
    setExportIncludesPasswords: actions.setExportIncludesPasswords,
    exportConfiguration: actions.exportConfiguration,
    notify: actions.notify,
    setEditorFontSize: actions.setEditorFontSize,
    setNotificationPosition: actions.setNotificationPosition,
    setLanguage: actions.setLanguage,
    setThemePreference: actions.setThemePreference,
    setSidebarWidth: actions.setSidebarWidth,
    setBottomPanelHeight: actions.setBottomPanelHeight,
    resetSettings: actions.resetSettings,
    resetSettingsKeys: actions.resetSettingsKeys,
    setZoomLevel: actions.setZoomLevel,
  };
}

export function useUpdater() {
  const { actions, state } = useWorkspace();
  return {
    updateDialogOpen: state.updateDialogOpen,
    updateProgress: state.updateProgress,
    dismissUpdateDialog: actions.dismissUpdateDialog,
    openDownloadPage: actions.openDownloadPage,
  };
}

export function useExplorer() {
  const { actions, meta, state } = useWorkspace();
  return {
    activeConnection: state.activeConnection,
    toggledNodes: state.toggledNodes,
    explorerFilter: state.explorerFilter,
    setExplorerFilter: actions.setExplorerFilter,
    connectedConnectionKeys: meta.connectedConnectionKeys,
    explorerTree: meta.explorerTree,
    openNewConnectionDialog: actions.openNewConnectionDialog,
    openLoadConfigDialog: actions.openLoadConfigDialog,
    openStorageSettings: actions.openStorageSettings,
    selectedConnectionKey: meta.selectedConnectionKey,
    selectedObjectId: state.selectedObjectId,
    storedConnections: state.storedConnections,
    confirmObjectTab: actions.confirmObjectTab,
    deleteConnection: actions.deleteConnection,
    openAddDatabase: actions.openAddDatabase,
    openDownloadBackup: actions.openDownloadBackup,
    openDeleteServer: actions.openDeleteServer,
    openRenameServer: actions.openRenameServer,
    openSavedConnection: actions.openSavedConnection,
    refreshConnection: actions.refreshConnection,
    selectObject: actions.selectObject,
    toggleNode: actions.toggleNode,
  };
}

export function useSqlEditor() {
  const { actions, state } = useWorkspace();
  return {
    activeTab: state.activeTab,
    activeTabId: state.activeTabId,
    completionObject: state.completionObject,
    isRunning: state.queryState === "running",
    selectedObject: state.selectedObject,
    sqlTabs: state.sqlTabs,
    closeSqlTab: actions.closeSqlTab,
    officializeSqlTab: actions.officializeSqlTab,
    reorderSqlTabs: actions.reorderSqlTabs,
    runQuery: actions.runQuery,
    saveActiveSqlTab: actions.saveActiveSqlTab,
    selectSqlTab: actions.selectSqlTab,
    updateActiveSql: actions.updateActiveSql,
  };
}

export function useResults() {
  const { actions, state } = useWorkspace();
  return {
    details: state.selectedObject,
    queryError: state.queryError,
    queryPagination: state.queryPagination,
    queryResult: state.queryResult,
    queryState: state.queryState,
    resultTab: state.resultTab,
    resultViewMode: state.resultViewMode,
    resultsOpen: state.resultsOpen,
    closeResults: actions.closeResults,
    copySchema: actions.copySchema,
    copyResult: actions.copyResult,
    downloadResults: actions.downloadResults,
    goToQueryPage: actions.goToQueryPage,
    selectResultTab: actions.selectResultTab,
    selectResultViewMode: actions.selectResultViewMode,
    setQueryPageSize: actions.setQueryPageSize,
  };
}

export function useToast() {
  const { state } = useWorkspace();
  return state.toast;
}

export function useObjectDetailsPanel() {
  const { actions, state } = useWorkspace();
  return {
    details: state.selectedObject,
    copyObjectName: actions.copyObjectName,
    openSchemaTab: actions.openSchemaTab,
    previewObject: actions.previewObject,
    refreshAll: actions.refreshAll,
  };
}

export function useEmptyWorkspace() {
  const { actions, meta, state } = useWorkspace();
  return {
    hasStoredConnections: meta.hasStoredConnections,
    storedConnections: state.storedConnections,
    openNewConnectionDialog: actions.openNewConnectionDialog,
    openLoadConfigDialog: actions.openLoadConfigDialog,
    openSavedConnection: actions.openSavedConnection,
  };
}

export function useDialogs() {
  const { actions, state } = useWorkspace();
  return {
    connectionDialogOpen: state.dialogs.connection,
    addDatabaseRequest: state.addDatabaseRequest,
    deleteConnectionRequest: state.deleteConnectionRequest,
    deleteServerRequest: state.deleteServerRequest,
    renameServerRequest: state.renameServerRequest,
    dialogInitialDraft: state.dialogInitialDraft,
    passwordConnection: state.passwordConnection,
    unsavedTabsDialogOpen: state.dialogs.unsavedTabs,
    loadConfigDialogOpen: state.dialogs.loadConfig,
    shortcutsDialogOpen: state.dialogs.shortcuts,
    closeShortcutsDialog: actions.closeShortcutsDialog,
    closeLoadConfigDialog: actions.closeLoadConfigDialog,
    closeAddDatabaseDialog: actions.closeAddDatabaseDialog,
    closeDeleteConnectionDialog: actions.closeDeleteConnectionDialog,
    closeDeleteServerDialog: actions.closeDeleteServerDialog,
    closeRenameServerDialog: actions.closeRenameServerDialog,
    closePasswordDialog: actions.closePasswordDialog,
    closeUnsavedTabsDialog: actions.closeUnsavedTabsDialog,
    closeWindowAfterResolution: actions.closeWindowAfterResolution,
    confirmAddDatabase: actions.confirmAddDatabase,
    confirmDeleteConnection: actions.confirmDeleteConnection,
    confirmDeleteServer: actions.confirmDeleteServer,
    confirmRenameServer: actions.confirmRenameServer,
    connectStoredConnection: actions.connectStoredConnection,
    saveConnection: actions.saveConnection,
    setConnectionDialogOpen: actions.setConnectionDialogOpen,
  };
}

export function useBackup() {
  const { actions, state } = useWorkspace();
  return {
    backupRequest: state.backupRequest,
    closeBackupDialog: actions.closeBackupDialog,
    chooseBackupDirectory: actions.chooseBackupDirectory,
    runBackup: actions.runBackup,
  };
}

export function savedConnectionNodeId(connection: StoredConnectionDraft) {
  return `saved-connection:${connection.engine}:${connection.host}:${connection.port}:${connection.database}:${connection.user}`;
}

export function formatColumn(column: ColumnDefinition) {
  const traits = [
    column.primaryKey ? translate("traits.primaryKey") : null,
    column.nullable ? translate("traits.nullable") : translate("traits.notNull"),
    column.indexed ? translate("traits.indexed") : null,
  ].filter(Boolean);

  return `${column.dataType}${traits.length ? ` - ${traits.join(", ")}` : ""}`;
}

export function formatIndex(index: DatabaseObjectDetails["indexes"][number]) {
  const traits = [
    index.primary ? translate("traits.primary") : null,
    index.unique ? translate("traits.unique") : null,
  ].filter(Boolean);
  return `${index.columns.join(", ")}${traits.length ? ` ${traits.join(" ")}` : ""}`;
}
