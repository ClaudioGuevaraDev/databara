import {
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  Link,
  Pencil,
  RefreshCw,
  ServerOff,
  Unlink,
} from "lucide-react";
import { memo } from "react";
import { useI18n } from "../../i18n/I18nContext";
import { savedConnectionNodeId, useWorkspaceActions } from "../../workspace/workspaceCore";
import type { ExplorerRow as ExplorerRowModel } from "./explorerRows";
import { TreeIcon } from "./TreeIcon";

// Fully-formed class strings instead of `cn(...)` per row: `cn` runs
// tailwind-merge, which tokenizes and conflict-resolves the whole string, and
// this component renders once per visible node. Both variants are spelled out so
// there is nothing to merge (no `text-muted-foreground` vs `text-foreground`
// conflict to resolve at runtime).
const ROW_CLASS_BASE =
  "group flex h-7 w-full items-center gap-1.5 rounded px-1.5 text-left text-[12.5px] transition-colors hover:bg-muted hover:text-foreground";
const ROW_CLASS_IDLE = `${ROW_CLASS_BASE} text-muted-foreground`;
const ROW_CLASS_SELECTED = `${ROW_CLASS_BASE} border border-primary/25 bg-[hsl(var(--primary)/0.12)] text-foreground shadow-[inset_2px_0_0_hsl(var(--primary))]`;
const ICON_CLASS_IDLE = "shrink-0 text-muted-foreground";
const ICON_CLASS_SELECTED = "shrink-0 text-primary";
const ACTION_CLASS =
  "flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:bg-muted focus:text-foreground";
const ACTION_CLASS_WARN =
  "flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-amber-400 focus:bg-muted focus:text-amber-400";
const BACKUP_ACTION_CLASS = `mr-1 ${ACTION_CLASS}`;

// Enter/Space on a `role="button"` span, without letting the row's own click
// handler also fire.
function isActivationKey(key: string) {
  return key === "Enter" || key === " ";
}

/**
 * A single sidebar row. Memoized on purpose: `row` comes from a memoized flat
 * list and `selected` is a boolean, so unrelated workspace state (typing in the
 * SQL editor, query results arriving) no longer re-renders the whole tree.
 * Actions come from the actions-only context, whose identity never changes.
 */
export const ExplorerRow = memo(function ExplorerRow({
  row,
  selected,
}: {
  row: ExplorerRowModel;
  selected: boolean;
}) {
  const { t } = useI18n();
  const actions = useWorkspaceActions();
  const { connected, connectionKey, hasChildren, isSavedConnection, nodeId, storedConnection } =
    row;

  return (
    <button
      onClick={() => {
        if (hasChildren) actions.toggleNode(row.key);
        if (row.selectable) actions.selectObject(nodeId, connectionKey);
        // A live connection group toggles its tables; only an unconnected one
        // should (re)open the connect/password flow.
        if (isSavedConnection && !connected) actions.openSavedConnection(nodeId);
      }}
      onDoubleClick={() => {
        if (row.selectable) actions.confirmObjectTab(nodeId, connectionKey);
      }}
      className={selected ? ROW_CLASS_SELECTED : ROW_CLASS_IDLE}
      style={{ paddingLeft: `${6 + row.depth * 16}px` }}
    >
      {hasChildren || isSavedConnection ? (
        hasChildren && !row.collapsed ? (
          <ChevronDown size={14} className="shrink-0" />
        ) : (
          <ChevronRight size={14} className="shrink-0" />
        )
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      <TreeIcon
        className={selected ? ICON_CLASS_SELECTED : ICON_CLASS_IDLE}
        kind={row.kind}
        isServer={row.isServer}
      />
      <span className="truncate">{row.label}</span>
      {row.isServer ? (
        <span className="ml-auto flex shrink-0 items-center gap-0">
          <span
            role="button"
            tabIndex={0}
            title={t("explorer.addDatabase")}
            onClick={(event) => {
              event.stopPropagation();
              actions.openAddDatabase(nodeId);
            }}
            onKeyDown={(event) => {
              if (!isActivationKey(event.key)) return;
              event.preventDefault();
              event.stopPropagation();
              actions.openAddDatabase(nodeId);
            }}
            className={ACTION_CLASS}
          >
            <span className="relative flex items-center justify-center">
              <Database size={12} />
              <Link
                size={8}
                strokeWidth={3}
                className="absolute -bottom-1 -right-1 rounded-full bg-[hsl(var(--background))]"
              />
            </span>
          </span>
          <span
            role="button"
            tabIndex={0}
            title={t("explorer.renameServer")}
            onClick={(event) => {
              event.stopPropagation();
              actions.openRenameServer(nodeId);
            }}
            onKeyDown={(event) => {
              if (!isActivationKey(event.key)) return;
              event.preventDefault();
              event.stopPropagation();
              actions.openRenameServer(nodeId);
            }}
            className={ACTION_CLASS}
          >
            <Pencil size={12} />
          </span>
          <span
            role="button"
            tabIndex={0}
            title={t("explorer.disconnectServer")}
            onClick={(event) => {
              event.stopPropagation();
              actions.openDeleteServer(nodeId);
            }}
            onKeyDown={(event) => {
              if (!isActivationKey(event.key)) return;
              event.preventDefault();
              event.stopPropagation();
              actions.openDeleteServer(nodeId);
            }}
            className={ACTION_CLASS_WARN}
          >
            <ServerOff size={12} />
          </span>
        </span>
      ) : storedConnection ? (
        <span className="ml-auto flex shrink-0 items-center gap-0">
          <span className="flex h-5 w-5 items-center justify-center">
            <span
              title={connected ? t("explorer.connected") : t("explorer.savedConnection")}
              className={
                connected
                  ? "h-2.5 w-2.5 rounded-full border border-emerald-300/80 bg-emerald-400 shadow-[0_0_10px_hsl(142_76%_55%/0.45)]"
                  : "h-2.5 w-2.5 rounded-full border border-amber-300/70 bg-amber-300/75 shadow-[0_0_6px_hsl(43_96%_56%/0.16)]"
              }
            />
          </span>
          {connected ? (
            <span
              role="button"
              tabIndex={0}
              title={t("explorer.refreshTables")}
              onClick={(event) => {
                event.stopPropagation();
                void actions.refreshConnection(connectionKey);
              }}
              onKeyDown={(event) => {
                if (!isActivationKey(event.key)) return;
                event.preventDefault();
                event.stopPropagation();
                void actions.refreshConnection(connectionKey);
              }}
              className={ACTION_CLASS}
            >
              <RefreshCw size={12} />
            </span>
          ) : null}
          {connected ? (
            <span
              role="button"
              tabIndex={0}
              title={t("explorer.downloadBackup")}
              onClick={(event) => {
                event.stopPropagation();
                actions.openDownloadBackup(connectionKey);
              }}
              onKeyDown={(event) => {
                if (!isActivationKey(event.key)) return;
                event.preventDefault();
                event.stopPropagation();
                actions.openDownloadBackup(connectionKey);
              }}
              className={BACKUP_ACTION_CLASS}
            >
              <span className="relative flex items-center justify-center">
                <Database size={12} />
                <Download
                  size={8}
                  strokeWidth={3}
                  className="absolute -bottom-1 -right-2 rounded-full bg-[hsl(var(--background))]"
                />
              </span>
            </span>
          ) : null}
          <span
            role="button"
            tabIndex={0}
            title={t("explorer.disconnectDatabase")}
            onClick={(event) => {
              event.stopPropagation();
              actions.deleteConnection(
                isSavedConnection ? nodeId : savedConnectionNodeId(storedConnection),
              );
            }}
            onKeyDown={(event) => {
              if (!isActivationKey(event.key)) return;
              event.preventDefault();
              event.stopPropagation();
              actions.deleteConnection(
                isSavedConnection ? nodeId : savedConnectionNodeId(storedConnection),
              );
            }}
            className={ACTION_CLASS_WARN}
          >
            <Unlink size={12} />
          </span>
        </span>
      ) : null}
    </button>
  );
});
