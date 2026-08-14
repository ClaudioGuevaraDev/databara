import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef } from "react";
import { useI18n } from "../../i18n/I18nContext";
import { useExplorer } from "../../workspace/workspaceCore";
import { ExplorerRow } from "./ExplorerRow";
import { flattenExplorerTree } from "./explorerRows";

// One-shot per session: the sidebar auto-centers the selected row only the first
// time (initial load). Only an app reload resets it.
let sidebarAutoScrolled = false;

// Height of a collapsed row (`h-7`) at 100% zoom. Only a starting estimate — real
// heights are measured, because the app's zoom setting scales them.
const ESTIMATED_ROW_HEIGHT = 28;

export function ExplorerTree() {
  const { t } = useI18n();
  const {
    connectedConnectionKeys,
    explorerFilter,
    explorerTree,
    selectedConnectionKey,
    selectedObjectId,
    storedConnections,
    toggledNodes,
  } = useExplorer();
  // Typing in the filter box repaints the input immediately while the (much more
  // expensive) re-flattened list renders in the background.
  const deferredFilter = useDeferredValue(explorerFilter);
  const rows = useMemo(
    () =>
      flattenExplorerTree({
        connectedConnectionKeys,
        filter: deferredFilter,
        storedConnections,
        toggledNodes,
        tree: explorerTree,
      }),
    [connectedConnectionKeys, deferredFilter, explorerTree, storedConnections, toggledNodes],
  );
  const containerRef = useRef<HTMLDivElement>(null);

  // At most one row can match (node ids are scoped by connection), so the index
  // doubles as the "is selected" test below. Memoized to keep the scan off the
  // path of unrelated re-renders.
  const selectedIndex = useMemo(
    () =>
      rows.findIndex(
        (row) => row.nodeId === selectedObjectId && row.connectionKey === selectedConnectionKey,
      ),
    [rows, selectedConnectionKey, selectedObjectId],
  );

  // Only the visible rows are mounted. A connected schema can hold thousands of
  // tables, and expanding it used to mount them all — plus two SVG icons each —
  // in one synchronous commit, which is what made the sidebar scroll stutter.
  // `useVirtualizer` trips the react-hooks "incompatible library" advisory: the
  // React Compiler would decline to auto-memoize this component because the hook
  // hands back functions. That's informational here — the compiler isn't part of
  // this build (`@vitejs/plugin-react` runs without it) and the expensive work is
  // memoized by hand above (`rows`, `selectedIndex`) or windowed below.
  const getRowKey = useCallback((index: number) => rows[index]?.key ?? index, [rows]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    getItemKey: getRowKey,
    getScrollElement: () => containerRef.current,
    // `offsetHeight` instead of the default `getBoundingClientRect()`: the app
    // scales the whole webview with CSS `zoom` (50%–200%), which makes rects
    // report visual pixels while `scrollTop` stays in layout pixels. Mixing the
    // two spaces would drift the further you scroll.
    measureElement: (element) => (element as HTMLElement).offsetHeight,
    overscan: 8,
  });

  // Center the selected row once per session (on load/reconnect, after the tree
  // has expanded down to the active table). From the second selection onwards the
  // scroll position is left alone.
  useEffect(() => {
    if (sidebarAutoScrolled || selectedIndex < 0) return;
    virtualizer.scrollToIndex(selectedIndex, { align: "center" });
    sidebarAutoScrolled = true;
  }, [selectedIndex, virtualizer]);

  return (
    <div
      ref={containerRef}
      className="scroll-overlay min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1.5 py-2"
    >
      {/* Spacer sized to the full list; only the visible rows are mounted inside
          it, absolutely positioned at their measured offsets. No `useMemo` around
          the map: with a virtual window this allocates ~30 elements, not
          thousands, so memoizing it would only add a stale-UI risk. */}
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          return row ? (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <ExplorerRow row={row} selected={virtualRow.index === selectedIndex} />
            </div>
          ) : null;
        })}
      </div>
      {deferredFilter.trim() && rows.length === 0 ? (
        <div className="px-2 py-3 text-[12px] text-muted-foreground">{t("explorer.noMatches")}</div>
      ) : null}
    </div>
  );
}
