import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  clampBottomPanelHeight,
  clampEditorFontSize,
  clampSidebarWidth,
  clampZoomLevel,
  closeMainWindowAfterUnsavedResolution,
  completeStartup,
  emitStartupProgress,
  connectPostgres,
  deleteConnectionPassword,
  deleteServerLabel,
  deleteStoredConnection,
  fetchServerDatabaseNames,
  getConnectionPassword,
  getPostgresObjectDetails,
  listPostgresTree,
  buildConfigurationExport,
  clearImportAutoConnectFlag,
  defaultAppSettings,
  loadAppSettings,
  loadServerLabels,
  loadStoredConnections,
  readImportAutoConnectFlag,
  saveServerLabel,
  backupDatabase,
  pickDirectory,
  pickSavePath,
  runPostgresQuery,
  saveAppSettings,
  saveStoredConnection,
  setUnsavedSqlTabs,
  storeConnectionPassword,
  updatesSupported,
  writeTextFile,
  type AppSettings,
  type StoredConnectionDraft,
} from "../databaraService";
import { exportQueryResultCsv } from "../query/exportCsv";
import { exportQueryResultJson } from "../query/exportJson";
import { translate } from "../i18n/translate";
import { buildObjectSchema } from "../components/results/objectSchema";
import {
  type ConnectionDraft,
  type ConnectionProfile,
  type DatabaseObjectDetails,
  type DatabaseTreeNode,
  type QueryPagination,
  type QueryState,
  type QueryResult,
  type ResultExportFormat,
  type ResultExportScope,
  type ResultPanelTab,
  type ResultViewMode,
  type SqlTab,
  type Toast,
  type ToastTone,
  type UpdateProgress,
} from "../types";
import {
  checkForUpdate,
  downloadAndInstallUpdate,
  openDownloadPage,
  relaunchApp,
} from "../updaterService";
import {
  savedConnectionNodeId,
  WorkspaceContext,
  type SettingsTab,
  type AddDatabaseRequest,
  type BackupRequest,
  type DeleteServerRequest,
  type RenameServerRequest,
  type WorkspaceContextValue,
} from "./workspaceCore";
import {
  activeDatabaseNodeId,
  buildCountSql,
  buildDefaultObjectSql,
  buildObjectTabLabel,
  buildPageSql,
  buildStoredConnectionTree,
  connectionDisplayName,
  connectionKey,
  copyText,
  correctSqlFromHint,
  formatCommandMessage,
  isReadQuery,
  mergeExplorerTree,
  normalizeBaseSql,
  parseTrailingLimit,
  readErrorMessage,
  removeConnectionFromTree,
  serverNodeId,
} from "./workspaceContext.utils";
import {
  buildOfficialObjectTabId,
  buildTemporaryObjectTabId,
  createOfficialSqlTab,
  loadSqlTabsForConnection,
  officializeSqlTab,
  saveSqlTabsForConnection,
} from "./workspaceSqlTabs";
import { defaultDatabaseEngine, isFileEngine } from "../connectionEngines";

// Per-tab, in-memory query state (never persisted to localStorage).
type TabResult = {
  state: QueryState;
  result: QueryResult | null;
  pagination: QueryPagination | null;
  error: string | null;
  connectionId: string;
  baseSql: string;
};

const emptyTabResult: TabResult = {
  state: "idle",
  result: null,
  pagination: null,
  error: null,
  connectionId: "",
  baseSql: "",
};

const defaultRowLimit = 50;

// Splash window timing: keep it visible at least this long so it doesn't flash
// by on fast startups, and never hold the user there longer than the timeout if
// some startup step hangs.
const SPLASH_MIN_DISPLAY_MS = 600;
const SPLASH_TIMEOUT_MS = 10000;

function getTabSelectionState(tab: SqlTab | null) {
  return {
    clearObjectDetails: !tab?.objectId,
    selectedObjectId: tab?.objectId ?? "",
  };
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [storedConnections, setStoredConnections] = useState<StoredConnectionDraft[]>(() =>
    loadStoredConnections(),
  );
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [dialogInitialDraft, setDialogInitialDraft] = useState<StoredConnectionDraft | null>(null);
  const [passwordConnection, setPasswordConnection] = useState<StoredConnectionDraft | null>(null);
  const [deleteConnectionRequest, setDeleteConnectionRequest] =
    useState<StoredConnectionDraft | null>(null);
  const [renameServerRequest, setRenameServerRequest] = useState<RenameServerRequest | null>(null);
  const [deleteServerRequest, setDeleteServerRequest] = useState<DeleteServerRequest | null>(null);
  const [addDatabaseRequest, setAddDatabaseRequest] = useState<AddDatabaseRequest | null>(null);
  const [backupRequest, setBackupRequest] = useState<BackupRequest | null>(null);
  const [serverLabels, setServerLabels] = useState<Record<string, string>>(loadServerLabels);
  const [connections, setConnections] = useState<ConnectionProfile[]>([]);
  const [activeConnectionId, setActiveConnectionId] = useState("");
  const [activeExplorerTree, setActiveExplorerTree] = useState<DatabaseTreeNode[]>([]);
  const [toggledNodes, setToggledNodes] = useState<Set<string>>(new Set());
  // Transient (in-memory) sidebar table filter; never persisted.
  const [explorerFilter, setExplorerFilter] = useState("");
  const [selectedObjectId, setSelectedObjectId] = useState("");
  const [selectedObjectConnectionId, setSelectedObjectConnectionId] = useState("");
  const [selectedObject, setSelectedObject] = useState<DatabaseObjectDetails | null>(null);
  const [completionObject, setCompletionObject] = useState<DatabaseObjectDetails | null>(null);
  const [sqlTabs, setSqlTabs] = useState<SqlTab[]>([]);
  const [activeTabId, setActiveTabId] = useState("");
  const [resultsByTab, setResultsByTab] = useState<Record<string, TabResult>>({});
  const [resultTab, setResultTab] = useState<ResultPanelTab>("results");
  const [resultViewMode, setResultViewMode] = useState<ResultViewMode>("table");
  const [resultsOpen, setResultsOpen] = useState(true);
  const [closeWithUnsavedDialogOpen, setCloseWithUnsavedDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = useState(false);
  const [loadConfigDialogOpen, setLoadConfigDialogOpen] = useState(false);
  const [settingsTab, setSettingsTabState] = useState<SettingsTab>("general");
  // Tab the gear button reopens on: only manual tab clicks update it, so opening
  // Storage via the "download configuration" buttons doesn't overwrite it.
  const [rememberedSettingsTab, setRememberedSettingsTab] = useState<SettingsTab>("general");
  const [settings, setSettings] = useState<AppSettings>(loadAppSettings);
  // One-time flag from a configuration import that bundled passwords: this single
  // startup auto-connects every saved connection even when "keep connections
  // active" is off. Read once at mount; cleared once the reconnect loop runs.
  const [importAutoConnect] = useState(() => readImportAutoConnectFlag());
  // True on startup while saved connections are being reconnected, so the UI can
  // hold off the "no connections" view instead of flashing it before reconnect.
  const [autoReconnecting, setAutoReconnecting] = useState(
    () =>
      (settings.keepConnectionsActive.enabled || importAutoConnect) && storedConnections.length > 0,
  );
  const [toast, setToast] = useState<Toast | null>(null);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null);
  // True once the startup update check has resolved (no update / error). Used to
  // decide when the main window is ready to be revealed behind the splash.
  const [updateCheckDone, setUpdateCheckDone] = useState(false);
  // True after the splash has shown for its minimum display time, so it doesn't
  // flash by on fast/first-run startups.
  const [splashMinElapsed, setSplashMinElapsed] = useState(false);
  // How many saved connections have been processed by the startup reconnect loop
  // (counts attempts, success or not) — drives the splash progress percentage.
  const [reconnectedCount, setReconnectedCount] = useState(0);
  const updateInProgressRef = useRef(false);
  const didCheckUpdateRef = useRef(false);
  const didAutoReconnectRef = useRef(false);
  // Fires the splash → main window handoff exactly once.
  const startupRevealedRef = useRef(false);
  const hasUnsavedTabsRef = useRef(false);
  const runningTabsRef = useRef<Set<string>>(new Set());
  const toastCounterRef = useRef(0);
  const sqlTabsRef = useRef<SqlTab[]>([]);
  const activeTabIdRef = useRef("");
  // Read inside connectAndStoreConnection without making it depend on settings;
  // kept current by the settings effect below.
  const keepConnectionsActiveRef = useRef(settings.keepConnectionsActive.enabled);
  const activateSiblingConnectionsRef = useRef(settings.activateSiblingConnections.enabled);
  const discoverServerDatabasesRef = useRef(settings.discoverServerDatabases.enabled);
  // Mirror of live connections, read during background orchestration to dedupe
  // against already-connected databases without re-creating the connect callback.
  const connectionsRef = useRef<ConnectionProfile[]>(connections);
  // Plaintext passwords of live connections, kept in memory for the session so
  // enabling "keep connections active" later can persist them to the keychain.
  const livePasswordsRef = useRef<Map<string, string>>(new Map());

  const activeConnection =
    connections.find((connection) => connection.id === activeConnectionId) ??
    connections[0] ??
    null;
  const selectedConnection = connections.find(
    (connection) => connection.id === selectedObjectConnectionId,
  );
  const selectedConnectionKey = selectedConnection ? connectionKey(selectedConnection) : "";
  const requiresConnection = connections.length === 0;
  const activeTab = sqlTabs.find((tab) => tab.id === activeTabId) ?? null;
  const activeTabResult = resultsByTab[activeTabId] ?? null;
  const queryState = activeTabResult?.state ?? "idle";
  const queryResult = activeTabResult?.result ?? null;
  const queryPagination = activeTabResult?.pagination ?? null;
  const queryError = activeTabResult?.error ?? null;
  const hasUnsavedTabs = sqlTabs.some((tab) => tab.dirty);
  const hasStoredConnections = storedConnections.length > 0;
  const explorerTree = useMemo(
    () => buildStoredConnectionTree(storedConnections, activeExplorerTree, serverLabels),
    [activeExplorerTree, serverLabels, storedConnections],
  );
  const connectedConnectionKeys = useMemo(
    () => new Set(connections.map((connection) => connectionKey(connection))),
    [connections],
  );

  // Apply the zoom setting to the whole webview and persist any change.
  // Runs on mount too, so a saved zoom is restored on startup. 100% means
  // normal, so we clear the property instead of setting "1".
  useEffect(() => {
    document.documentElement.style.zoom =
      settings.zoom.level === 100 ? "" : String(settings.zoom.level / 100);
    keepConnectionsActiveRef.current = settings.keepConnectionsActive.enabled;
    activateSiblingConnectionsRef.current = settings.activateSiblingConnections.enabled;
    discoverServerDatabasesRef.current = settings.discoverServerDatabases.enabled;
    saveAppSettings(settings);
  }, [settings]);

  // Apply the color theme by toggling the `.dark` class on <html> (Tailwind's
  // class strategy). For "system" we resolve `prefers-color-scheme` and keep the
  // app in sync live via a media-query listener. Runs on mount so a saved theme
  // is restored (the inline script in index.html already sets the initial class
  // to avoid a flash before React mounts).
  useEffect(() => {
    const preference = settings.theme.preference;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = preference === "dark" || (preference === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    if (preference !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.theme.preference]);

  // Keep the live-connections mirror current for background orchestration.
  useEffect(() => {
    connectionsRef.current = connections;
  }, [connections]);

  const connectionByKey = useCallback(
    (key: string | undefined) =>
      key ? (connections.find((connection) => connectionKey(connection) === key) ?? null) : null,
    [connections],
  );

  const notify = useCallback((text: string, tone: ToastTone = "default") => {
    toastCounterRef.current += 1;
    setToast({ id: toastCounterRef.current, text, tone });
  }, []);

  // Checks for a new release and, if found, downloads + installs it while a modal
  // reports progress, then relaunches into the new version. `silent` (the startup
  // check) stays quiet when already up to date or running outside the desktop app.
  const startUpdateCheck = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      if (updateInProgressRef.current) return;

      if (!("__TAURI_INTERNALS__" in window)) {
        if (!silent) notify(translate("toast.updatesDesktopOnly"), "warning");
        return;
      }

      updateInProgressRef.current = true;
      try {
        // Checking can fail for benign reasons (no published release yet, offline,
        // missing latest.json). Never surface that as a modal — on the startup
        // (silent) check stay quiet; on a manual check just toast it.
        let update;
        try {
          update = await checkForUpdate();
        } catch (error) {
          if (!silent)
            notify(
              translate("toast.updateCheckFailed", { error: readErrorMessage(error) }),
              "warning",
            );
          return;
        }

        if (!update) {
          if (!silent) notify(translate("toast.upToDate"), "success");
          return;
        }

        // This install can't replace itself (Linux .deb/.rpm). Don't attempt a
        // download that would fail with "permission denied" — point the user
        // straight to the manual download instead.
        if (!(await updatesSupported())) {
          setUpdateProgress({
            phase: "unavailable",
            downloaded: 0,
            total: 0,
            version: update.version,
            notes: update.body ?? undefined,
          });
          setUpdateDialogOpen(true);
          return;
        }

        // An update exists: show the modal and report download/install progress.
        // Errors from here on are shown inside the modal since it's already open.
        setUpdateProgress({
          phase: "downloading",
          downloaded: 0,
          total: 0,
          version: update.version,
          notes: update.body ?? undefined,
        });
        setUpdateDialogOpen(true);

        try {
          await downloadAndInstallUpdate(update, ({ downloaded, total }) => {
            setUpdateProgress((previous) => ({
              phase: total > 0 && downloaded >= total ? "installing" : "downloading",
              downloaded,
              total,
              version: previous?.version ?? update.version,
              notes: previous?.notes,
            }));
          });

          setUpdateProgress((previous) => ({
            phase: "done",
            downloaded: previous?.total ?? 0,
            total: previous?.total ?? 0,
            version: previous?.version ?? update.version,
            notes: previous?.notes,
          }));
          await relaunchApp();
        } catch (error) {
          setUpdateProgress((previous) => ({
            phase: "error",
            downloaded: previous?.downloaded ?? 0,
            total: previous?.total ?? 0,
            version: previous?.version,
            error: readErrorMessage(error),
          }));
        }
      } finally {
        updateInProgressRef.current = false;
      }
    },
    [notify],
  );

  const dismissUpdateDialog = useCallback(() => {
    // Only meaningful on terminal states (error/done) — during download the modal
    // shows no close affordance, so this won't interrupt an in-flight install.
    setUpdateDialogOpen(false);
    setUpdateProgress(null);
  }, []);

  useEffect(() => {
    if (didCheckUpdateRef.current) return;
    didCheckUpdateRef.current = true;
    // When an update is found, this promise stays pending until the download +
    // install completes (then the app relaunches), so `updateDialogOpen` is what
    // triggers the reveal in that case — not this. When there's no update it
    // resolves quickly and lets the main window come up.
    void startUpdateCheck({ silent: true }).finally(() => setUpdateCheckDone(true));
  }, [startUpdateCheck]);

  // Splash → main window handoff. The main window starts hidden; we reveal it
  // (and close the splash) once startup work is done, so it appears already
  // populated instead of painting connections in one by one.
  const revealMainWindow = useCallback(() => {
    if (startupRevealedRef.current) return;
    startupRevealedRef.current = true;
    // Push the bar to 100% and give the splash a beat to render it before the
    // hand-off closes it.
    void emitStartupProgress(100);
    window.setTimeout(() => void completeStartup(), 220);
  }, []);

  // Emit real startup progress to the splash: the update check counts as one unit
  // plus one per saved connection the reconnect loop processes.
  useEffect(() => {
    const target =
      settings.keepConnectionsActive.enabled || importAutoConnect ? storedConnections.length : 0;
    const total = target + 1;
    const completed = (updateCheckDone ? 1 : 0) + Math.min(reconnectedCount, target);
    void emitStartupProgress((completed / total) * 100);
  }, [
    importAutoConnect,
    reconnectedCount,
    settings.keepConnectionsActive.enabled,
    storedConnections.length,
    updateCheckDone,
  ]);

  // Reveal immediately when the update dialog opens (an update was found or the
  // install can't self-update) so the user sees that modal without delay.
  useEffect(() => {
    if (updateDialogOpen) revealMainWindow();
  }, [updateDialogOpen, revealMainWindow]);

  // Keep the splash visible for a brief minimum so it doesn't flash by.
  useEffect(() => {
    const timer = window.setTimeout(() => setSplashMinElapsed(true), SPLASH_MIN_DISPLAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // Reveal once the update check has settled and saved connections have finished
  // reconnecting (`!autoReconnecting`), after the minimum splash time.
  useEffect(() => {
    if (!updateCheckDone || autoReconnecting || !splashMinElapsed) return;
    revealMainWindow();
  }, [autoReconnecting, revealMainWindow, splashMinElapsed, updateCheckDone]);

  // Safety net: never leave the user stuck on the splash if some startup step
  // hangs (e.g. a connection that never resolves).
  useEffect(() => {
    const timer = window.setTimeout(revealMainWindow, SPLASH_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [revealMainWindow]);

  const patchTabResult = useCallback((tabId: string, patch: Partial<TabResult>) => {
    setResultsByTab((previous) => ({
      ...previous,
      [tabId]: { ...emptyTabResult, ...previous[tabId], ...patch },
    }));
  }, []);

  const syncExplorerSelectionWithTab = useCallback(
    (tab: SqlTab | null) => {
      const nextSelection = getTabSelectionState(tab);
      setSelectedObjectId(nextSelection.selectedObjectId);
      const owner = connectionByKey(tab?.connectionKey);
      if (owner) setSelectedObjectConnectionId(owner.id);
      if (
        nextSelection.clearObjectDetails ||
        selectedObject?.id !== nextSelection.selectedObjectId
      ) {
        setSelectedObject(null);
      }
    },
    [connectionByKey, selectedObject],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadSelectedObject() {
      if (!selectedObjectId) return;
      // Load details from the connection that owns the selected object, not the
      // globally active one — they can differ in a multi-connection workspace.
      const connection =
        connections.find((item) => item.id === selectedObjectConnectionId) ?? activeConnection;
      if (!connection) return;
      try {
        const details = await getPostgresObjectDetails(connection.id, selectedObjectId);
        if (!cancelled) {
          setSelectedObject(details);
          setCompletionObject(details);
        }
      } catch (error) {
        if (!cancelled) {
          setSelectedObject(null);
          notify(readErrorMessage(error), "warning");
        }
      }
    }

    void loadSelectedObject();

    return () => {
      cancelled = true;
    };
  }, [activeConnection, connections, notify, selectedObjectConnectionId, selectedObjectId]);

  useEffect(() => {
    hasUnsavedTabsRef.current = hasUnsavedTabs;
    if (!("__TAURI_INTERNALS__" in window)) return;

    void setUnsavedSqlTabs(hasUnsavedTabs).catch((error) => {
      notify(readErrorMessage(error), "warning");
    });
  }, [hasUnsavedTabs, notify]);

  useEffect(() => {
    sqlTabsRef.current = sqlTabs;
    activeTabIdRef.current = activeTabId;
  }, [activeTabId, sqlTabs]);

  useEffect(() => {
    // Tabs from all connected databases live in one array; persist each connection's
    // own subset under its storage key (saveSqlTabsForConnection keeps activeTabId only
    // when it belongs to that connection).
    for (const connection of connections) {
      const key = connectionKey(connection);
      saveSqlTabsForConnection(
        connection,
        sqlTabs.filter((tab) => tab.connectionKey === key),
        activeTabId,
      );
    }
  }, [activeTabId, connections, sqlTabs]);

  useEffect(() => {
    function handleUnsavedTabsCloseRequest() {
      setCloseWithUnsavedDialogOpen(true);
    }

    window.addEventListener("databara-unsaved-tabs-close-requested", handleUnsavedTabsCloseRequest);
    return () => {
      window.removeEventListener(
        "databara-unsaved-tabs-close-requested",
        handleUnsavedTabsCloseRequest,
      );
    };
  }, []);

  const commitSqlTab = useCallback((tabId: string) => {
    const currentTabs = sqlTabsRef.current;
    const currentTab = currentTabs.find((tab) => tab.id === tabId);
    if (!currentTab) return null;

    // Fall back to the tab's own connection (the active connection may differ now
    // that tabs from several databases coexist).
    const fallbackKey = currentTab.connectionKey ?? "";
    const officialized = officializeSqlTab(currentTabs, currentTab.id, fallbackKey);
    const nextActiveTabId = officialized.activeTabId;
    const nextTabs = officialized.tabs.map((tab) =>
      tab.id === nextActiveTabId ? { ...tab, dirty: false, savedSql: tab.sql } : tab,
    );
    const committedTab = nextTabs.find((tab) => tab.id === nextActiveTabId) ?? currentTab;

    sqlTabsRef.current = nextTabs;
    activeTabIdRef.current = nextActiveTabId;
    setSqlTabs(nextTabs);
    setActiveTabId(nextActiveTabId);
    // Persistence is handled reactively by the per-connection save effect.

    return committedTab;
  }, []);

  const officializeSqlTabAction = useCallback(
    (tabId: string) => {
      commitSqlTab(tabId);
    },
    [commitSqlTab],
  );

  const saveActiveSqlTab = useCallback(async () => {
    const currentTabId = activeTabIdRef.current;
    if (!currentTabId) return;
    const committedTab = commitSqlTab(currentTabId);
    if (!committedTab) return;
    notify(translate("toast.tabSaved", { label: committedTab.label }), "success");
  }, [commitSqlTab, notify]);

  const saveDirtySqlTabs = useCallback(async () => {
    const dirtyTabs = sqlTabsRef.current.filter((tab) => tab.dirty);
    if (dirtyTabs.length === 0) return;

    let lastCommittedTabId = activeTabIdRef.current;

    for (const dirtyTab of dirtyTabs) {
      const committedTab = commitSqlTab(dirtyTab.id);
      if (committedTab) {
        lastCommittedTabId = committedTab.id;
      }
    }

    if (lastCommittedTabId) {
      activeTabIdRef.current = lastCommittedTabId;
      setActiveTabId(lastCommittedTabId);
    }

    notify(translate("toast.tabsSaved", { count: dirtyTabs.length }), "success");
  }, [commitSqlTab, notify]);

  const loadConnectionSqlTabs = useCallback(
    (connection: ConnectionProfile) => {
      const savedTabs = loadSqlTabsForConnection(connection);
      // Merge this connection's persisted tabs into the shared tab bar (dedupe by id)
      // instead of replacing — tabs from other connected databases stay open.
      setSqlTabs((current) => {
        const existing = new Set(current.map((tab) => tab.id));
        const additions = savedTabs.tabs.filter((tab) => !existing.has(tab.id));
        return [...current, ...additions];
      });

      const nextActiveTab = savedTabs.tabs.find((tab) => tab.id === savedTabs.activeTabId) ?? null;

      // Expand the sidebar nodes needed to reveal the restored tabs: the database
      // (for any open tab) and the schema ancestor of the active object tab, so the
      // active tab's object is visible and highlighted instead of hidden under a
      // collapsed schema. Node ids/keys mirror ExplorerNode + the backend tree.
      const connKey = connectionKey(connection);
      const expandKeys: string[] = [];
      if (savedTabs.tabs.length > 0) {
        expandKeys.push(`${connKey}::${activeDatabaseNodeId(connection)}`);
      }
      const activeSchema = nextActiveTab?.objectId?.split(":")[1]?.split(".")[0];
      if (activeSchema) expandKeys.push(`${connKey}::schema:${activeSchema}`);
      if (expandKeys.length > 0) {
        setToggledNodes((current) => {
          const missing = expandKeys.filter((key) => !current.has(key));
          if (missing.length === 0) return current;
          const next = new Set(current);
          missing.forEach((key) => next.add(key));
          return next;
        });
      }

      setCompletionObject(null);
      if (nextActiveTab) {
        setActiveTabId(nextActiveTab.id);
        syncExplorerSelectionWithTab(nextActiveTab);
        // syncExplorerSelectionWithTab resolves the owning connection via the live
        // `connections` list, which is still stale here during connect/auto-reconnect
        // (this just-connected profile isn't in it yet). We know the owner directly,
        // so set it explicitly to highlight the active object's tree node.
        if (nextActiveTab.objectId) setSelectedObjectConnectionId(connection.id);
      }
    },
    [syncExplorerSelectionWithTab],
  );

  // Core connect: opens the connection, stores it, and updates UI state. Does no
  // background orchestration, so it is safe to call for both principal and
  // background (silent) connections without recursion.
  const connectCore = useCallback(
    async (draft: ConnectionDraft, options?: { silent?: boolean; announce?: boolean }) => {
      const connectionDraft = { ...draft, name: connectionDisplayName(draft) };
      const result = await connectPostgres(connectionDraft);
      const nextStoredConnections = saveStoredConnection(connectionDraft);
      setStoredConnections(nextStoredConnections);
      setConnections((current) => {
        const next = [
          result.connection,
          ...current.filter((item) => item.id !== result.connection.id),
        ];
        connectionsRef.current = next;
        return next;
      });
      setActiveExplorerTree((current) => mergeExplorerTree(current, result.tree));
      // Cache the password in memory (for the session) so enabling "keep
      // connections active" later can persist already-live connections, and
      // persist it now to the keychain when the setting is already on.
      livePasswordsRef.current.set(connectionKey(connectionDraft), draft.password);
      if (keepConnectionsActiveRef.current) {
        void storeConnectionPassword(connectionKey(connectionDraft), draft.password);
      }
      // Background (silent) connections must not steal focus from the database the
      // user actively connected to, so they skip activation, tab loading and toast.
      if (!options?.silent) {
        setActiveConnectionId(result.connection.id);
        loadConnectionSqlTabs(result.connection);
        // Startup auto-reconnect activates + loads tabs but stays quiet: it passes
        // announce:false so it doesn't spam a success toast per saved connection.
        if (options?.announce !== false) {
          notify(translate("toast.connected", { name: result.connection.name }), "success");
        }
      }
      return result;
    },
    [loadConnectionSqlTabs, notify],
  );

  const connectAndStoreConnection = useCallback(
    async (
      draft: ConnectionDraft,
      options?: { skipOrchestration?: boolean; announce?: boolean },
    ) => {
      // A database the user connects from a dialog (connection form / password /
      // add-database) is expanded in the sidebar. Startup reconnects pass
      // skipOrchestration and background siblings go through connectCore directly,
      // so neither force-expands. Seeded before connecting to avoid a closed→open flicker.
      if (!options?.skipOrchestration) {
        const expandKey = `${connectionKey(draft)}::${activeDatabaseNodeId(draft)}`;
        setToggledNodes((current) => {
          if (current.has(expandKey)) return current;
          const next = new Set(current);
          next.add(expandKey);
          return next;
        });
      }

      const result = await connectCore(draft, { announce: options?.announce });
      const connectionDraft = { ...draft, name: connectionDisplayName(draft) };

      // Background orchestration for the database the user actively connected to
      // (the "principal"). Skipped for startup reconnects.
      if (options?.skipOrchestration) return;

      const activate = activateSiblingConnectionsRef.current;
      const discover = discoverServerDatabasesRef.current;
      if (!activate && !discover) return;

      const serverId = serverNodeId(connectionDraft);
      const principalKey = connectionKey(connectionDraft);

      // (3) List: discover and SAVE the other databases on this server (without
      // connecting). Runs before "activate" so the saved set it reads is complete.
      if (discover) {
        try {
          const names = await fetchServerDatabaseNames(
            result.connection.id,
            result.connection.engine,
          );
          let nextStored = loadStoredConnections();
          let changed = false;
          for (const database of names) {
            const candidate: ConnectionDraft = { ...connectionDraft, database, password: "" };
            const candidateKey = connectionKey(candidate);
            if (nextStored.some((connection) => connectionKey(connection) === candidateKey)) {
              continue;
            }
            nextStored = saveStoredConnection({
              ...candidate,
              name: connectionDisplayName(candidate),
            });
            changed = true;
          }
          if (changed) setStoredConnections(nextStored);
        } catch {
          // Discovery is best-effort — ignore failures silently.
        }
      }

      // (2) Activate: connect the SAVED databases on this server (the ones List just
      // saved, plus any saved earlier), silently (no toast, no focus steal). These
      // stay collapsed in the sidebar by default. Without "list" and without saved
      // siblings, this connects nothing.
      if (activate) {
        const siblings = loadStoredConnections().filter(
          (connection) =>
            serverNodeId(connection) === serverId && connectionKey(connection) !== principalKey,
        );
        for (const sibling of siblings) {
          const siblingKey = connectionKey(sibling);
          if (connectionsRef.current.some((item) => connectionKey(item) === siblingKey)) continue;
          const password =
            sibling.user === connectionDraft.user
              ? draft.password
              : ((await getConnectionPassword(siblingKey)) ?? "");
          if (!password) continue;
          try {
            await connectCore({ ...sibling, password }, { silent: true });
          } catch {
            // No access / wrong password / server issue — skip silently.
          }
        }
      }
    },
    [connectCore],
  );

  // On startup, when "keep connections active" is on — or once after a config
  // import that bundled passwords — reconnect each saved connection whose
  // password is in the keychain. Failures (changed password, server down, no
  // keychain) just warn and leave that connection inactive.
  useEffect(() => {
    if (didAutoReconnectRef.current) return;
    didAutoReconnectRef.current = true;
    if (!settings.keepConnectionsActive.enabled && !importAutoConnect) return;

    void (async () => {
      try {
        for (const connection of storedConnections) {
          try {
            const password = await getConnectionPassword(connectionKey(connection));
            // File engines (SQLite) have no stored password but can still reconnect.
            if (password || isFileEngine(connection.engine)) {
              await connectAndStoreConnection(
                { ...connection, password: password ?? "" },
                { skipOrchestration: true, announce: false },
              );
            }
          } catch (error) {
            notify(
              translate("toast.reconnectFailed", {
                database: connection.database,
                error: readErrorMessage(error),
              }),
              "warning",
            );
          } finally {
            setReconnectedCount((count) => count + 1);
          }
        }
      } finally {
        setAutoReconnecting(false);
        // Consume the one-time import flag so later startups revert to being
        // governed solely by the "keep connections active" setting.
        if (importAutoConnect) clearImportAutoConnectFlag();
      }
    })();
  }, [
    connectAndStoreConnection,
    importAutoConnect,
    notify,
    settings.keepConnectionsActive.enabled,
    storedConnections,
  ]);

  const updateActiveSql = useCallback(
    (sql: string) => {
      if (!activeTabId) return;

      setSqlTabs((tabs) => {
        return tabs.map((tab) =>
          tab.id === activeTabId
            ? {
                ...tab,
                dirty: sql !== (tab.savedSql ?? tab.sql),
                sql,
              }
            : tab,
        );
      });
    },
    [activeTabId],
  );

  const activateConnection = useCallback((connection: ConnectionProfile) => {
    // All connections' tabs already live in the shared bar; just switch focus.
    setActiveConnectionId(connection.id);
  }, []);

  const openTemporaryObjectTab = useCallback(
    (objectId: string, tabConnectionKey: string) => {
      if (!tabConnectionKey) return;

      const engine = connectionByKey(tabConnectionKey)?.engine ?? defaultDatabaseEngine;
      const sql = buildDefaultObjectSql(objectId, defaultRowLimit, engine);
      const label = buildObjectTabLabel(objectId);

      setSqlTabs((tabs) => {
        // Clicking an object that's already open (official or preview) just focuses
        // its tab instead of spawning a duplicate — and never clobbers its edits.
        const existingObjectTab = tabs.find(
          (currentTab) =>
            currentTab.objectId === objectId && currentTab.connectionKey === tabConnectionKey,
        );
        if (existingObjectTab) {
          setActiveTabId(existingObjectTab.id);
          return tabs;
        }

        const reusableTemporaryTab = tabs.find(
          (currentTab) =>
            currentTab.state === "temporary" &&
            !currentTab.dirty &&
            currentTab.connectionKey === tabConnectionKey,
        );

        if (reusableTemporaryTab) {
          const nextTab: SqlTab = {
            ...reusableTemporaryTab,
            label,
            objectId,
            savedSql: sql,
            sql,
          };
          setActiveTabId(nextTab.id);
          return tabs.map((currentTab) =>
            currentTab.id === reusableTemporaryTab.id ? nextTab : currentTab,
          );
        }

        const nextTab: SqlTab = {
          connectionKey: tabConnectionKey,
          dirty: false,
          id: buildTemporaryObjectTabId(tabConnectionKey, objectId),
          label,
          objectId,
          savedSql: sql,
          sql,
          state: "temporary",
        };
        setActiveTabId(nextTab.id);
        return [...tabs, nextTab];
      });
    },
    [connectionByKey],
  );

  const makeObjectTabOfficial = useCallback(
    (objectId: string, tabConnectionKey: string) => {
      if (!tabConnectionKey) return;

      const engine = connectionByKey(tabConnectionKey)?.engine ?? defaultDatabaseEngine;
      const label = buildObjectTabLabel(objectId);
      const sql = buildDefaultObjectSql(objectId, defaultRowLimit, engine);
      const officialTabId = buildOfficialObjectTabId(tabConnectionKey, objectId);

      setSqlTabs((tabs) => {
        const existingOfficialTab = tabs.find(
          (tab) =>
            tab.state === "official" &&
            tab.objectId === objectId &&
            tab.connectionKey === tabConnectionKey,
        );
        if (existingOfficialTab) {
          setActiveTabId(existingOfficialTab.id);
          return tabs;
        }

        const temporaryTab = tabs.find(
          (tab) =>
            tab.state === "temporary" &&
            tab.objectId === objectId &&
            tab.connectionKey === tabConnectionKey,
        );
        if (temporaryTab) {
          setActiveTabId(officialTabId);
          return officializeSqlTab(tabs, temporaryTab.id, tabConnectionKey).tabs;
        }

        const officialTab = createOfficialSqlTab({
          connectionKey: tabConnectionKey,
          dirty: false,
          label,
          objectId,
          savedSql: sql,
          sql,
        });
        setActiveTabId(officialTabId);
        return [...tabs, officialTab];
      });
    },
    [connectionByKey],
  );

  const selectObject = useCallback(
    (objectId: string, objectConnectionKey?: string) => {
      const connection = connectionByKey(objectConnectionKey) ?? activeConnection;
      if (!connection) return;
      activateConnection(connection);
      setSelectedObjectId(objectId);
      setSelectedObjectConnectionId(connection.id);
      openTemporaryObjectTab(objectId, connectionKey(connection));
    },
    [activeConnection, activateConnection, connectionByKey, openTemporaryObjectTab],
  );

  const confirmObjectTab = useCallback(
    (objectId: string, objectConnectionKey?: string) => {
      const connection = connectionByKey(objectConnectionKey) ?? activeConnection;
      if (!connection) return;
      activateConnection(connection);
      setSelectedObjectId(objectId);
      setSelectedObjectConnectionId(connection.id);
      makeObjectTabOfficial(objectId, connectionKey(connection));
    },
    [activeConnection, activateConnection, connectionByKey, makeObjectTabOfficial],
  );

  // Fetches a single page of a read query via SQL LIMIT/OFFSET and renders it into
  // the given tab. `baseSql` must be normalized; `totalRows` comes from the COUNT run.
  const executePage = useCallback(
    async (
      tabId: string,
      connectionId: string,
      baseSql: string,
      pageSize: number,
      page: number,
      totalRows: number,
      pageSizeLocked: boolean,
    ) => {
      patchTabResult(tabId, { state: "running", error: null });
      try {
        const engine =
          connectionsRef.current.find((item) => item.id === connectionId)?.engine ??
          defaultDatabaseEngine;
        const pageSql = buildPageSql(baseSql, pageSize, page, engine);
        const execution = await runPostgresQuery(connectionId, pageSql);
        patchTabResult(tabId, {
          state: "success",
          error: null,
          connectionId,
          baseSql,
          pagination: { page, pageSize, totalRows, pageSizeLocked },
          result: {
            id: crypto.randomUUID(),
            sql: pageSql,
            columns: execution.columns,
            columnTypes: execution.columnTypes,
            rows: execution.rows,
            durationMs: execution.durationMs,
            rowCount: execution.rowCount,
            message: translate("results.runSummary", {
              rows: totalRows,
              pageSize,
              durationMs: execution.durationMs,
            }),
          },
        });
        return true;
      } catch (error) {
        const message = readErrorMessage(error);
        patchTabResult(tabId, { state: "error", error: message, result: null, pagination: null });
        notify(message, "warning");
        return false;
      }
    },
    [notify, patchTabResult],
  );

  const runQuery = useCallback(async () => {
    if (requiresConnection || !activeConnection) {
      setDialogInitialDraft(null);
      setConnectionDialogOpen(true);
      notify(translate("toast.createConnectionBeforeRun"), "warning");
      return;
    }

    // Officializing a temporary tab can change its id (object tabs), so use the
    // committed tab as the source of truth for both the id and the SQL to run —
    // otherwise results would be stored under the dead temporary id.
    const committedTab = activeTabId ? commitSqlTab(activeTabId) : null;
    if (!committedTab) {
      notify(translate("toast.openTabToRun"), "warning");
      return;
    }

    const tabId = committedTab.id;
    if (runningTabsRef.current.has(tabId)) return;

    const sql = committedTab.sql.trim();
    if (!sql) {
      notify(translate("toast.writeQueryToRun"), "warning");
      return;
    }

    // Run against the connection that owns this tab, not the globally active one.
    const connection = connectionByKey(committedTab.connectionKey) ?? activeConnection;
    if (!connection) {
      notify(translate("toast.tabConnectionUnavailable"), "warning");
      return;
    }
    const connectionId = connection.id;
    const baseSql = normalizeBaseSql(sql);

    runningTabsRef.current.add(tabId);
    setResultsOpen(true);
    setResultTab("results");
    patchTabResult(tabId, { state: "running", error: null, connectionId, baseSql });

    // Runs a query derived from `sqlBase` and, when it fails because PostgreSQL folded
    // an unquoted camelCase identifier to lowercase, re-runs it with that identifier
    // quoted (using the server's own hint). Guarded to only act on case-only mismatches,
    // so typos are never rewritten. Returns the corrected base SQL so the read path can
    // page over the same corrected query.
    const MAX_AUTOFIX = 20;
    const runAutoCorrect = async (sqlBase: string, buildSql: (value: string) => string) => {
      let current = sqlBase;
      for (let attempt = 0; ; attempt++) {
        try {
          const execution = await runPostgresQuery(connectionId, buildSql(current));
          return { execution, correctedSql: current };
        } catch (error) {
          const fixed =
            attempt < MAX_AUTOFIX ? correctSqlFromHint(current, readErrorMessage(error)) : null;
          if (!fixed || fixed === current) throw error;
          current = fixed;
        }
      }
    };

    try {
      if (isReadQuery(baseSql)) {
        // Pagination is always on for read queries. Page size = the user's own
        // trailing LIMIT if present (locked), otherwise the selector default. We
        // strip that trailing LIMIT so COUNT/OFFSET page over the full result set.
        const parsed = parseTrailingLimit(baseSql, connection.engine);
        const pageSize = parsed?.pageSize ?? defaultRowLimit;
        const querySql = parsed?.baseSql ?? baseSql;
        const locked = parsed !== null;
        const { execution: count, correctedSql } = await runAutoCorrect(querySql, buildCountSql);
        const totalRows = Number(count.rows[0]?.[0] ?? 0);
        // `correctedSql` (not `querySql`) becomes the tab's stored baseSql, so later
        // page fetches run the same auto-quoted query.
        const ok = await executePage(
          tabId,
          connectionId,
          correctedSql,
          pageSize,
          0,
          totalRows,
          locked,
        );
        if (ok) notify(translate("toast.runSummary", { rows: totalRows, pageSize }), "success");
      } else {
        // Non-read statements run as-is (no pagination). Returned rows (incl.
        // RETURNING) still show, plus the command result message.
        const { execution, correctedSql } = await runAutoCorrect(baseSql, (value) => value);
        const message = formatCommandMessage(
          execution.commandTag,
          execution.rowsAffected,
          execution.durationMs,
        );
        patchTabResult(tabId, {
          state: "success",
          error: null,
          connectionId,
          baseSql: correctedSql,
          pagination: null,
          result: {
            id: crypto.randomUUID(),
            sql: correctedSql,
            columns: execution.columns,
            columnTypes: execution.columnTypes,
            rows: execution.rows,
            durationMs: execution.durationMs,
            rowCount: execution.rowCount,
            message,
          },
        });
        notify(message, "success");
      }
    } catch (error) {
      const message = readErrorMessage(error);
      patchTabResult(tabId, { state: "error", error: message, result: null, pagination: null });
      notify(message, "warning");
    } finally {
      runningTabsRef.current.delete(tabId);
    }
  }, [
    activeConnection,
    activeTabId,
    commitSqlTab,
    connectionByKey,
    executePage,
    notify,
    patchTabResult,
    requiresConnection,
  ]);

  const goToQueryPage = useCallback(
    async (page: number) => {
      const tabId = activeTabId;
      const current = resultsByTab[tabId];
      if (!current || !current.pagination) return;
      if (runningTabsRef.current.has(tabId)) return;

      const { pageSize, totalRows, page: currentPage, pageSizeLocked } = current.pagination;
      const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
      const target = Math.min(Math.max(page, 0), totalPages - 1);
      if (target === currentPage) return;

      runningTabsRef.current.add(tabId);
      try {
        await executePage(
          tabId,
          current.connectionId,
          current.baseSql,
          pageSize,
          target,
          totalRows,
          pageSizeLocked,
        );
      } finally {
        runningTabsRef.current.delete(tabId);
      }
    },
    [activeTabId, executePage, resultsByTab],
  );

  const setQueryPageSize = useCallback(
    async (pageSize: number) => {
      const tabId = activeTabId;
      const current = resultsByTab[tabId];
      if (!current || !current.pagination || pageSize === current.pagination.pageSize) return;
      // When the page size comes from the user's own LIMIT, the selector is locked.
      if (current.pagination.pageSizeLocked) return;
      if (runningTabsRef.current.has(tabId)) return;

      runningTabsRef.current.add(tabId);
      try {
        await executePage(
          tabId,
          current.connectionId,
          current.baseSql,
          pageSize,
          0,
          current.pagination.totalRows,
          false,
        );
      } finally {
        runningTabsRef.current.delete(tabId);
      }
    },
    [activeTabId, executePage, resultsByTab],
  );

  const refreshAll = useCallback(async () => {
    if (!activeConnection) {
      notify(translate("toast.createConnectionBeforeRefresh"), "warning");
      return;
    }

    try {
      const tree = await listPostgresTree(activeConnection.id);
      setActiveExplorerTree((current) => mergeExplorerTree(current, tree));
      notify(translate("toast.workspaceRefreshed"), "success");
    } catch (error) {
      notify(readErrorMessage(error), "warning");
    }
  }, [activeConnection, notify]);

  const refreshConnection = useCallback(
    async (targetConnectionKey?: string) => {
      const connection = connectionByKey(targetConnectionKey) ?? activeConnection;
      if (!connection) {
        notify(translate("toast.connectBeforeRefresh"), "warning");
        return;
      }

      try {
        const tree = await listPostgresTree(connection.id);
        setActiveExplorerTree((current) => mergeExplorerTree(current, tree));
        // Refresh the selected object's details too, if it belongs to this connection.
        if (selectedObjectId && selectedObjectConnectionId === connection.id) {
          const details = await getPostgresObjectDetails(connection.id, selectedObjectId);
          setSelectedObject(details);
          setCompletionObject(details);
        }
        notify(
          translate("toast.connectionRefreshed", { database: connection.database }),
          "success",
        );
      } catch (error) {
        notify(readErrorMessage(error), "warning");
      }
    },
    [activeConnection, connectionByKey, notify, selectedObjectConnectionId, selectedObjectId],
  );

  const previewObject = useCallback(
    async (objectId = selectedObjectId) => {
      if (requiresConnection) {
        notify(translate("toast.createConnectionBeforePreview"), "warning");
        return;
      }

      void objectId;
      notify(translate("toast.previewNotEnabled"), "warning");
    },
    [notify, requiresConnection, selectedObjectId],
  );

  const openSchemaTab = useCallback(async () => {
    if (requiresConnection) {
      notify(translate("toast.createConnectionBeforeSchema"), "warning");
      return;
    }

    setResultsOpen(true);
    setResultTab("schema");
  }, [notify, requiresConnection]);

  const copyResult = useCallback(async () => {
    if (!queryResult) {
      notify(translate("toast.runBeforeCopyResults"), "warning");
      return;
    }

    await copyText(
      [
        queryResult.columns.join("\t"),
        ...queryResult.rows.map((row) => row.map((cell) => cell ?? "NULL").join("\t")),
      ].join("\n"),
    );
    notify(translate("toast.resultsCopied"), "success");
  }, [notify, queryResult]);

  const copySchema = useCallback(async () => {
    if (!selectedObject) {
      notify(translate("toast.selectObjectBeforeCopySchema"), "warning");
      return;
    }

    await copyText(buildObjectSchema(selectedObject));
    notify(translate("toast.schemaCopied"), "success");
  }, [notify, selectedObject]);

  const downloadResults = useCallback(
    async (format: ResultExportFormat, scope: ResultExportScope) => {
      if (!queryResult) {
        notify(translate("toast.runBeforeDownload"), "warning");
        return;
      }

      // "All pages" re-runs the (LIMIT-stripped) base query to pull every row;
      // "current page" — and any non-paginated result — exports what's loaded.
      let exportResult = queryResult;
      if (scope === "all" && activeTabResult?.pagination) {
        try {
          const execution = await runPostgresQuery(
            activeTabResult.connectionId,
            activeTabResult.baseSql,
          );
          exportResult = {
            ...queryResult,
            rows: execution.rows,
            columns: execution.columns,
            columnTypes: execution.columnTypes,
            rowCount: execution.rowCount,
          };
        } catch (error) {
          notify(readErrorMessage(error), "warning");
          return;
        }
      }

      const content =
        format === "csv" ? exportQueryResultCsv(exportResult) : exportQueryResultJson(exportResult);

      try {
        const path = await pickSavePath(`databara-results.${format}`, format);
        if (!path) {
          notify(translate("toast.downloadCancelled"), "default");
          return;
        }
        await writeTextFile(path, content);
        notify(translate("toast.downloadSaved"), "success");
      } catch (error) {
        notify(readErrorMessage(error) || translate("toast.downloadFailed"), "warning");
      }
    },
    [activeTabResult, notify, queryResult],
  );

  const copyObjectName = useCallback(async () => {
    if (!selectedObject) return;
    await copyText(`${selectedObject.schema}.${selectedObject.name}`);
    notify(translate("toast.objectNameCopied"), "success");
  }, [notify, selectedObject]);

  const saveConnection = useCallback(
    async (draft: ConnectionDraft) => {
      try {
        await connectAndStoreConnection(draft);
        setConnectionDialogOpen(false);
      } catch (error) {
        notify(readErrorMessage(error), "warning");
      }
    },
    [connectAndStoreConnection, notify],
  );

  const openNewConnectionDialog = useCallback(() => {
    setDialogInitialDraft(null);
    setConnectionDialogOpen(true);
  }, []);

  const openSavedConnection = useCallback(
    (nodeId: string) => {
      const connection = storedConnections.find((item) => savedConnectionNodeId(item) === nodeId);
      if (!connection) return;

      // File engines (SQLite) have no password — connect directly, skip the prompt.
      if (isFileEngine(connection.engine)) {
        void (async () => {
          try {
            await connectAndStoreConnection({
              ...connection,
              name: connectionDisplayName(connection),
              password: "",
            });
          } catch (error) {
            notify(readErrorMessage(error), "warning");
          }
        })();
        return;
      }

      // The password dialog already prompts for the password — no toast needed.
      setPasswordConnection(connection);
    },
    [connectAndStoreConnection, notify, storedConnections],
  );

  const connectStoredConnection = useCallback(
    async (connection: StoredConnectionDraft, password: string) => {
      await connectAndStoreConnection({
        ...connection,
        name: connectionDisplayName(connection),
        password,
      });
      setPasswordConnection(null);
    },
    [connectAndStoreConnection],
  );

  const deleteConnection = useCallback(
    (nodeId: string) => {
      const connection = storedConnections.find((item) => savedConnectionNodeId(item) === nodeId);
      if (!connection) return;

      setDeleteConnectionRequest(connection);
    },
    [storedConnections],
  );

  const selectSqlTab = useCallback(
    (tabId: string) => {
      const tab = sqlTabs.find((item) => item.id === tabId) ?? null;
      setActiveTabId(tabId);
      // The active connection follows the active tab so operations default to its DB.
      const owner = connectionByKey(tab?.connectionKey);
      if (owner) setActiveConnectionId(owner.id);
      syncExplorerSelectionWithTab(tab);
    },
    [connectionByKey, sqlTabs, syncExplorerSelectionWithTab],
  );

  // Drag-to-reorder in the tab strip. Addressed by id (not source index) because
  // officializing a preview tab mid-gesture can merge it away and shift indexes.
  const reorderSqlTabs = useCallback((tabId: string, toIndex: number) => {
    const current = sqlTabsRef.current;
    const fromIndex = current.findIndex((tab) => tab.id === tabId);
    if (fromIndex === -1) return;

    const target = Math.min(Math.max(toIndex, 0), current.length - 1);
    if (target === fromIndex) return;

    const next = [...current];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(target, 0, moved);
    // Written off the ref rather than through a functional updater, and
    // mirrored back into it exactly like `commitSqlTab` does: dropping a preview
    // tab officializes it right after this call, and `commitSqlTab` reads the
    // ref synchronously — a deferred updater would let it overwrite the new
    // order with the pre-drag array.
    sqlTabsRef.current = next;
    setSqlTabs(next);
  }, []);

  const closeSqlTab = useCallback(
    (tabId: string) => {
      const closingTabIndex = sqlTabs.findIndex((tab) => tab.id === tabId);
      if (closingTabIndex === -1) return;

      const nextTabs = sqlTabs.filter((tab) => tab.id !== tabId);
      const nextActiveTab =
        tabId === activeTabId
          ? (nextTabs[closingTabIndex - 1] ?? nextTabs[closingTabIndex] ?? null)
          : (nextTabs.find((tab) => tab.id === activeTabId) ?? null);

      setSqlTabs(nextTabs);
      setActiveTabId(nextActiveTab?.id ?? "");
      // Keep the active connection in sync with the newly focused tab.
      const owner = connectionByKey(nextActiveTab?.connectionKey);
      if (owner) setActiveConnectionId(owner.id);
      syncExplorerSelectionWithTab(nextActiveTab);
      runningTabsRef.current.delete(tabId);
      setResultsByTab((previous) => {
        if (!(tabId in previous)) return previous;
        const next = { ...previous };
        delete next[tabId];
        return next;
      });
    },
    [activeTabId, connectionByKey, sqlTabs, syncExplorerSelectionWithTab],
  );

  const closeWindowAfterResolution = useCallback(
    async (mode: "save" | "discard") => {
      if (mode === "save") {
        await saveDirtySqlTabs();
      }

      setCloseWithUnsavedDialogOpen(false);
      await closeMainWindowAfterUnsavedResolution();
    },
    [saveDirtySqlTabs],
  );

  useEffect(() => {
    function handleSaveShortcut(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      void saveActiveSqlTab();
    }

    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [saveActiveSqlTab]);

  // Removes one or more saved connections in a single batch: localStorage profiles,
  // keychain passwords, explorer tree nodes, and their SQL tabs. Used by both the
  // single-connection delete and the whole-server delete so cleanup stays identical.
  const removeConnections = useCallback(
    (toRemove: StoredConnectionDraft[]) => {
      if (toRemove.length === 0) return;

      const removeKeys = new Set(toRemove.map((item) => connectionKey(item)));
      let nextStoredConnections = storedConnections;
      for (const connection of toRemove) {
        nextStoredConnections = deleteStoredConnection(connection);
        void deleteConnectionPassword(connectionKey(connection));
      }

      const nextConnections = connections.filter((item) => !removeKeys.has(connectionKey(item)));

      setStoredConnections(nextStoredConnections);
      setActiveExplorerTree((current) =>
        toRemove.reduce((tree, connection) => removeConnectionFromTree(tree, connection), current),
      );
      setConnections(nextConnections);

      // Drop only the removed connections' tabs from the shared bar.
      const remainingTabs = sqlTabs.filter(
        (tab) => !tab.connectionKey || !removeKeys.has(tab.connectionKey),
      );
      setSqlTabs(remainingTabs);

      const wasActiveConnection =
        activeConnection && removeKeys.has(connectionKey(activeConnection));

      if (wasActiveConnection) {
        setSelectedObjectId("");
        setSelectedObject(null);
        setCompletionObject(null);
        // Refocus a surviving tab (and its connection) if the active one was removed.
        const stillActive = remainingTabs.some((tab) => tab.id === activeTabId);
        const nextActiveTab = stillActive
          ? (remainingTabs.find((tab) => tab.id === activeTabId) ?? null)
          : (remainingTabs[0] ?? null);
        setActiveTabId(nextActiveTab?.id ?? "");
        const owner = connectionByKey(nextActiveTab?.connectionKey) ?? nextConnections[0] ?? null;
        setActiveConnectionId(owner?.id ?? "");
      }
    },
    [activeConnection, activeTabId, connectionByKey, connections, sqlTabs, storedConnections],
  );

  const confirmDeleteConnection = useCallback(
    (connection: StoredConnectionDraft) => {
      removeConnections([connection]);
      notify(
        translate("toast.connectionDisconnected", { database: connection.database }),
        "success",
      );
      setDeleteConnectionRequest(null);
    },
    [notify, removeConnections],
  );

  // A server is the group of saved/active connections sharing engine:host:port.
  const serverConnectionsFor = useCallback(
    (serverId: string) => {
      const byKey = new Map<string, StoredConnectionDraft>();
      for (const connection of storedConnections) {
        if (serverNodeId(connection) === serverId) byKey.set(connectionKey(connection), connection);
      }
      for (const connection of connections) {
        const key = connectionKey(connection);
        if (serverNodeId(connection) === serverId && !byKey.has(key)) {
          byKey.set(key, {
            engine: connection.engine,
            name: connection.name,
            host: connection.host,
            port: connection.port,
            database: connection.database,
            user: connection.user,
            sslMode: connection.sslMode,
          });
        }
      }
      return [...byKey.values()];
    },
    [connections, storedConnections],
  );

  const openRenameServer = useCallback(
    (serverId: string) => {
      const first = serverConnectionsFor(serverId)[0];
      if (!first) return;
      setRenameServerRequest({
        serverId,
        host: first.host,
        port: first.port,
        currentName: serverLabels[serverId] ?? "",
      });
    },
    [serverConnectionsFor, serverLabels],
  );

  const confirmRenameServer = useCallback((serverId: string, name: string) => {
    setServerLabels(saveServerLabel(serverId, name));
    setRenameServerRequest(null);
  }, []);

  const openDeleteServer = useCallback(
    (serverId: string) => {
      const serverConnections = serverConnectionsFor(serverId);
      const first = serverConnections[0];
      if (!first) return;
      setDeleteServerRequest({
        serverId,
        host: first.host,
        port: first.port,
        connections: serverConnections,
      });
    },
    [serverConnectionsFor],
  );

  const confirmDeleteServer = useCallback(
    (serverId: string) => {
      const serverConnections = serverConnectionsFor(serverId);
      const first = serverConnections[0];
      removeConnections(serverConnections);
      setServerLabels(deleteServerLabel(serverId));
      notify(
        translate("toast.serverDisconnected", {
          name:
            serverLabels[serverId] ??
            (first ? `${first.host}:${first.port}` : translate("toast.serverFallbackName")),
        }),
        "success",
      );
      setDeleteServerRequest(null);
    },
    [notify, removeConnections, serverConnectionsFor, serverLabels],
  );

  // Add another database living on the same server, reusing a sibling connection's
  // credentials. The password comes from the keychain when available; otherwise the
  // modal prompts for it (needsPassword).
  const openAddDatabase = useCallback(
    async (serverId: string) => {
      const template = serverConnectionsFor(serverId)[0];
      if (!template) return;
      const password = await getConnectionPassword(connectionKey(template));
      setAddDatabaseRequest({
        serverId,
        host: template.host,
        port: template.port,
        needsPassword: !password,
      });
    },
    [serverConnectionsFor],
  );

  const confirmAddDatabase = useCallback(
    async (serverId: string, database: string, password?: string) => {
      const name = database.trim();
      if (!name) return;
      const template = serverConnectionsFor(serverId)[0];
      if (!template) return;
      const resolvedPassword =
        password ?? (await getConnectionPassword(connectionKey(template))) ?? "";
      await connectAndStoreConnection({
        ...template,
        database: name,
        password: resolvedPassword,
      });
      setAddDatabaseRequest(null);
    },
    [connectAndStoreConnection, serverConnectionsFor],
  );

  const openDownloadBackup = useCallback(
    (targetConnectionKey?: string) => {
      const connection = connectionByKey(targetConnectionKey) ?? activeConnection;
      if (!connection) {
        notify(translate("toast.connectBeforeRefresh"), "warning");
        return;
      }
      const today = new Date().toISOString().slice(0, 10);
      setBackupRequest({
        connectionKey: connectionKey(connection),
        databaseName: connection.database,
        defaultFileName: `${connection.database}_backup_${today}.sql`,
      });
    },
    [activeConnection, connectionByKey, notify],
  );

  const closeBackupDialog = useCallback(() => setBackupRequest(null), []);

  const chooseBackupDirectory = useCallback(() => pickDirectory(), []);

  const runBackup = useCallback(
    async (directory: string, fileName: string) => {
      const connection = connectionByKey(backupRequest?.connectionKey);
      if (!connection) {
        notify(translate("toast.connectBeforeRefresh"), "warning");
        throw new Error(translate("toast.connectBeforeRefresh"));
      }
      try {
        await backupDatabase(connection.id, directory, fileName);
        notify(translate("toast.backupSaved"), "success");
        setBackupRequest(null);
      } catch (error) {
        notify(readErrorMessage(error) || translate("toast.backupFailed"), "warning");
        throw error;
      }
    },
    [backupRequest, connectionByKey, notify],
  );

  const toggleNode = useCallback((nodeId: string) => {
    setToggledNodes((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const value: WorkspaceContextValue = {
    actions: {
      closeAddDatabaseDialog: () => setAddDatabaseRequest(null),
      closeDeleteConnectionDialog: () => setDeleteConnectionRequest(null),
      closeDeleteServerDialog: () => setDeleteServerRequest(null),
      closeRenameServerDialog: () => setRenameServerRequest(null),
      closePasswordDialog: () => setPasswordConnection(null),
      closeResults: () => setResultsOpen(false),
      closeSettingsDialog: () => setSettingsDialogOpen(false),
      openShortcutsDialog: () => setShortcutsDialogOpen(true),
      closeShortcutsDialog: () => setShortcutsDialogOpen(false),
      openLoadConfigDialog: () => setLoadConfigDialogOpen(true),
      closeLoadConfigDialog: () => setLoadConfigDialogOpen(false),
      closeSqlTab,
      closeUnsavedTabsDialog: () => setCloseWithUnsavedDialogOpen(false),
      closeWindowAfterResolution,
      confirmAddDatabase,
      confirmDeleteConnection,
      confirmDeleteServer,
      confirmRenameServer,
      confirmObjectTab,
      connectStoredConnection,
      setExplorerFilter,
      copySchema,
      copyObjectName,
      copyResult,
      deleteConnection,
      openAddDatabase,
      openDownloadBackup,
      closeBackupDialog,
      chooseBackupDirectory,
      runBackup,
      openDeleteServer,
      openRenameServer,
      downloadResults,
      goToQueryPage,
      openSchemaTab,
      openNewConnectionDialog,
      openSavedConnection,
      openSettingsDialog: () => {
        setSettingsTabState(rememberedSettingsTab);
        setSettingsDialogOpen(true);
      },
      openStorageSettings: () => {
        setSettingsTabState("storage");
        setSettingsDialogOpen(true);
      },
      setSettingsTab: (tab: SettingsTab) => {
        setSettingsTabState(tab);
        setRememberedSettingsTab(tab);
      },
      officializeSqlTab: officializeSqlTabAction,
      previewObject,
      refreshAll,
      refreshConnection,
      runQuery,
      saveActiveSqlTab,
      setQueryPageSize,
      saveConnection,
      selectObject,
      selectResultTab: setResultTab,
      selectResultViewMode: setResultViewMode,
      selectSqlTab,
      reorderSqlTabs,
      setConnectionDialogOpen,
      setKeepConnectionsActive: (enabled) => {
        setSettings((current) => ({ ...current, keepConnectionsActive: { enabled } }));
        if (enabled) {
          // Persist passwords of currently-live connections so they reconnect on startup.
          connections.forEach((connection) => {
            const key = connectionKey(connection);
            const password = livePasswordsRef.current.get(key);
            if (password) void storeConnectionPassword(key, password);
          });
        } else {
          // Turning it off removes every stored password from the keychain.
          storedConnections.forEach(
            (connection) => void deleteConnectionPassword(connectionKey(connection)),
          );
        }
      },
      setActivateSiblingConnections: (enabled) =>
        setSettings((current) => ({ ...current, activateSiblingConnections: { enabled } })),
      setDiscoverServerDatabases: (enabled) =>
        setSettings((current) => ({ ...current, discoverServerDatabases: { enabled } })),
      setExportIncludesPasswords: (enabled) =>
        setSettings((current) => ({ ...current, exportIncludesPasswords: { enabled } })),
      exportConfiguration: (includePasswords) =>
        buildConfigurationExport({
          includePasswords,
          livePasswords: Object.fromEntries(livePasswordsRef.current),
        }),
      notify,
      setZoomLevel: (level) =>
        setSettings((current) => ({
          ...current,
          zoom: { ...current.zoom, level: clampZoomLevel(level) },
        })),
      setEditorFontSize: (size) =>
        setSettings((current) => ({
          ...current,
          editorFontSize: { size: clampEditorFontSize(size) },
        })),
      setNotificationPosition: (position) =>
        setSettings((current) => ({
          ...current,
          notificationPosition: { position },
        })),
      setLanguage: (code) =>
        setSettings((current) => ({
          ...current,
          language: { code },
        })),
      setThemePreference: (preference) =>
        setSettings((current) => ({
          ...current,
          theme: { preference },
        })),
      setSidebarWidth: (width) =>
        setSettings((current) => ({
          ...current,
          sidebarWidth: { width: clampSidebarWidth(width) },
        })),
      setBottomPanelHeight: (height) =>
        setSettings((current) => ({
          ...current,
          bottomPanelHeight: { height: clampBottomPanelHeight(height) },
        })),
      resetSettings: () => setSettings(defaultAppSettings),
      resetSettingsKeys: <K extends keyof AppSettings>(keys: K[]) =>
        setSettings((current) => {
          const next = { ...current };
          for (const key of keys) next[key] = defaultAppSettings[key];
          return next;
        }),
      startUpdateCheck,
      dismissUpdateDialog,
      openDownloadPage: () => void openDownloadPage(),
      toggleNode,
      updateActiveSql,
    },
    meta: {
      autoReconnecting,
      connectedConnectionKeys,
      explorerTree,
      hasStoredConnections,
      hasUnsavedTabs,
      requiresConnection,
      selectedConnectionKey,
    },
    state: {
      activeConnection,
      activeTab,
      activeTabId,
      toggledNodes,
      explorerFilter,
      completionObject,
      connections,
      addDatabaseRequest,
      backupRequest,
      deleteConnectionRequest,
      deleteServerRequest,
      renameServerRequest,
      dialogInitialDraft,
      dialogs: {
        connection: connectionDialogOpen,
        settings: settingsDialogOpen,
        shortcuts: shortcutsDialogOpen,
        unsavedTabs: closeWithUnsavedDialogOpen,
        loadConfig: loadConfigDialogOpen,
      },
      passwordConnection,
      settings,
      settingsTab,
      queryError,
      queryPagination,
      queryResult,
      queryState,
      resultTab,
      resultViewMode,
      toast,
      resultsOpen,
      selectedObject,
      selectedObjectId,
      sqlTabs,
      storedConnections,
      updateDialogOpen,
      updateProgress,
    },
  };

  return <WorkspaceContext value={value}>{children}</WorkspaceContext>;
}
