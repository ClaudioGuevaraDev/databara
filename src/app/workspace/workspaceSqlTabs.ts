import type { ConnectionDraft, SqlTab } from "../types";
import { connectionKey } from "./workspaceContext.utils";

type PersistedSqlTabs = {
  activeTabId: string;
  tabs: SqlTab[];
};

const sqlTabsStoragePrefix = "databara.sqlTabs.v1";

export function sqlTabsStorageKey(
  connection: Pick<ConnectionDraft, "database" | "engine" | "host" | "port" | "user">,
) {
  return `${sqlTabsStoragePrefix}:${connectionKey(connection)}`;
}

function legacySqlTabsStorageKey(
  connection: Pick<ConnectionDraft, "database" | "host" | "port" | "user">,
) {
  return `${sqlTabsStoragePrefix}:${connection.host}:${connection.port}:${connection.database}:${connection.user}`;
}

export function buildTemporaryObjectTabId(connectionKeyValue: string, objectId: string) {
  return `tab:preview:${connectionKeyValue}:${objectId}:${Date.now()}`;
}

export function buildOfficialObjectTabId(connectionKeyValue: string, objectId: string) {
  return `tab:object:${connectionKeyValue}:${objectId}`;
}

export function createOfficialSqlTab({
  connectionKey,
  dirty,
  label,
  objectId,
  savedSql,
  sql,
}: {
  connectionKey: string;
  dirty: boolean;
  label: string;
  objectId?: string;
  savedSql?: string;
  sql: string;
}): SqlTab {
  return {
    connectionKey,
    dirty,
    id: objectId ? buildOfficialObjectTabId(connectionKey, objectId) : `tab:sql:${connectionKey}`,
    label,
    objectId,
    savedSql,
    sql,
    state: "official",
  };
}

export function officializeSqlTab(
  tabs: SqlTab[],
  tabId: string,
  fallbackConnectionKey: string,
): { activeTabId: string; tabs: SqlTab[] } {
  const targetTab = tabs.find((tab) => tab.id === tabId);
  if (!targetTab) {
    return { activeTabId: tabId, tabs };
  }

  if (targetTab.state === "official") {
    return { activeTabId: targetTab.id, tabs };
  }

  const nextConnectionKey = targetTab.connectionKey ?? fallbackConnectionKey;
  const officialTabId = targetTab.objectId
    ? buildOfficialObjectTabId(nextConnectionKey, targetTab.objectId)
    : targetTab.id;
  const existingOfficialTab = tabs.find(
    (tab) => tab.id !== targetTab.id && tab.state === "official" && tab.id === officialTabId,
  );

  if (existingOfficialTab) {
    const mergedOfficialTab: SqlTab = {
      ...existingOfficialTab,
      connectionKey: nextConnectionKey,
      dirty:
        targetTab.sql !== (existingOfficialTab.savedSql ?? targetTab.savedSql ?? targetTab.sql),
      label: targetTab.label,
      objectId: targetTab.objectId,
      sql: targetTab.sql,
    };

    return {
      activeTabId: mergedOfficialTab.id,
      tabs: tabs
        .filter((tab) => tab.id !== targetTab.id)
        .map((tab) => (tab.id === existingOfficialTab.id ? mergedOfficialTab : tab)),
    };
  }

  const officialTab: SqlTab = {
    ...targetTab,
    connectionKey: nextConnectionKey,
    id: officialTabId,
    state: "official",
  };

  return {
    activeTabId: officialTab.id,
    tabs: tabs.map((tab) => (tab.id === targetTab.id ? officialTab : tab)),
  };
}

function normalizePersistedSqlTab(tab: unknown, fallbackConnectionKey: string): SqlTab | null {
  if (!tab || typeof tab !== "object") return null;

  const candidate = tab as Partial<SqlTab>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.label !== "string" ||
    typeof candidate.sql !== "string"
  ) {
    return null;
  }

  return {
    connectionKey:
      typeof candidate.connectionKey === "string" ? candidate.connectionKey : fallbackConnectionKey,
    dirty: false,
    id: candidate.id,
    label: candidate.label,
    objectId: typeof candidate.objectId === "string" ? candidate.objectId : undefined,
    savedSql: candidate.sql,
    sql: candidate.sql,
    state: "official",
  };
}

export function loadSqlTabsForConnection(
  connection: Pick<ConnectionDraft, "database" | "engine" | "host" | "port" | "user">,
): PersistedSqlTabs {
  const storageKey = sqlTabsStorageKey(connection);
  const legacyStorageKey = legacySqlTabsStorageKey(connection);
  const rawTabs =
    window.localStorage.getItem(storageKey) ?? window.localStorage.getItem(legacyStorageKey);
  if (!rawTabs) return { activeTabId: "", tabs: [] };

  try {
    const parsed = JSON.parse(rawTabs) as Partial<PersistedSqlTabs>;
    const fallbackConnectionKey = connectionKey(connection);
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs.flatMap((tab) => {
          const normalized = normalizePersistedSqlTab(tab, fallbackConnectionKey);
          return normalized ? [normalized] : [];
        })
      : [];
    const activeTabId =
      typeof parsed.activeTabId === "string" && tabs.some((tab) => tab.id === parsed.activeTabId)
        ? parsed.activeTabId
        : (tabs[0]?.id ?? "");

    const persistedTabs = { activeTabId, tabs };
    if (storageKey !== legacyStorageKey && window.localStorage.getItem(storageKey) === null) {
      window.localStorage.setItem(storageKey, JSON.stringify(persistedTabs));
      window.localStorage.removeItem(legacyStorageKey);
    }

    return persistedTabs;
  } catch {
    window.localStorage.removeItem(storageKey);
    window.localStorage.removeItem(legacyStorageKey);
    return { activeTabId: "", tabs: [] };
  }
}

/**
 * Serializes what a connection persists: only official tabs, and only their
 * *saved* SQL. Split from the write so callers can compare the result with what
 * they wrote last — unsaved edits don't change these bytes, so typing produces
 * an identical payload and the write can be skipped entirely.
 */
export function serializeSqlTabsForConnection(tabs: SqlTab[], activeTabId: string): string {
  const officialTabs = tabs
    .filter((tab) => tab.state === "official")
    .map((tab) => ({
      ...tab,
      dirty: false,
      savedSql: undefined,
      sql: tab.savedSql ?? tab.sql,
    }));
  const persistedTabs: PersistedSqlTabs = {
    activeTabId: officialTabs.some((tab) => tab.id === activeTabId) ? activeTabId : "",
    tabs: officialTabs,
  };

  return JSON.stringify(persistedTabs);
}

export function writeSqlTabsForConnection(
  connection: Pick<ConnectionDraft, "database" | "engine" | "host" | "port" | "user">,
  serializedTabs: string,
) {
  window.localStorage.setItem(sqlTabsStorageKey(connection), serializedTabs);
}
