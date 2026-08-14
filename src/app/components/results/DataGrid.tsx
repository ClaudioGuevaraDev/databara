import { useVirtualizer } from "@tanstack/react-virtual";
import { type KeyboardEvent, type MouseEvent, useCallback, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nContext";
import {
  buildSelectionTsv,
  countCells,
  isInRange,
  type CellPosition,
} from "../../query/copySelection";
import type { QueryResult } from "../../types";
import { EmptyPanel } from "../ui";
import { CellContextMenu } from "./CellContextMenu";
import { DataGridRow } from "./DataGridRow";
import { useCellSelection } from "./useCellSelection";

// Mouse events are delegated on `<tbody>` rather than bound per cell, so the
// cell address is read back from the DOM. `data-cell` is always `row-col`.
function resolveCellPosition(target: EventTarget | null): CellPosition | null {
  const element = (target as HTMLElement | null)?.closest?.("[data-cell]");
  const raw = element?.getAttribute("data-cell");
  if (!raw) return null;

  const separator = raw.indexOf("-");
  const row = Number(raw.slice(0, separator));
  const col = Number(raw.slice(separator + 1));
  return Number.isNaN(row) || Number.isNaN(col) ? null : { row, col };
}

// Height of one row at 100% zoom; a starting estimate only, since real heights
// are measured (the app's zoom setting scales them).
const ESTIMATED_ROW_HEIGHT = 27;

export function DataGrid({
  queryResult,
  onCopyCells,
  scroller,
}: {
  queryResult: QueryResult | null;
  onCopyCells?: (text: string, cellCount: number) => void;
  // The scrolling element is the results panel's container, not the table — it is
  // shared with the other result views. Passed as an element (not a ref) so this
  // component re-renders once it exists.
  scroller: HTMLDivElement | null;
}) {
  const { t } = useI18n();
  const tableRef = useRef<HTMLTableElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const selection = useCellSelection({
    resultId: queryResult?.id ?? null,
    rowCount: queryResult?.rows.length ?? 0,
    colCount: queryResult?.columns.length ?? 0,
  });
  const { focus, range } = selection;

  // Only the visible rows are mounted, so a page of 500 rows no longer puts tens
  // of thousands of cells in the DOM. (`useVirtualizer` trips the react-hooks
  // "incompatible library" advisory about the React Compiler declining to
  // auto-memoize this component; informational here, the compiler isn't part of
  // this build.)
  const rowVirtualizer = useVirtualizer({
    count: queryResult?.rows.length ?? 0,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    getScrollElement: () => scroller,
    // `offsetHeight` instead of the default rect: CSS `zoom` (the app's 50%–200%
    // setting) makes rects report visual pixels while `scrollTop` stays in layout
    // pixels, and mixing the two drifts as you scroll.
    measureElement: (element) => (element as HTMLElement).offsetHeight,
    overscan: 6,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  // Keyboard navigation can walk outside the scrolled viewport, and now also to a
  // row that isn't mounted: scroll the row into view first, then line up the
  // column once the cell exists.
  const revealCell = useCallback(
    (row: number, col: number) => {
      rowVirtualizer.scrollToIndex(row, { align: "auto" });
      requestAnimationFrame(() => {
        tableRef.current
          ?.querySelector(`[data-cell="${row}-${col}"]`)
          ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    },
    [rowVirtualizer],
  );

  const copySelection = useCallback(
    (includeHeaders: boolean) => {
      if (!queryResult || !range || !onCopyCells) return;
      onCopyCells(buildSelectionTsv(queryResult, range, { includeHeaders }), countCells(range));
    },
    [onCopyCells, queryResult, range],
  );

  if (!queryResult) return <EmptyPanel text={t("results.emptyGrid")} />;

  // Hoisted handlers below don't keep the narrowing above, so alias it once.
  const result = queryResult;

  // Height of the rows above and below the window.
  const paddingTop = virtualRows[0]?.start ?? 0;
  const paddingBottom =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0;

  function handleKeyDown(event: KeyboardEvent<HTMLTableElement>) {
    const mod = event.ctrlKey || event.metaKey;

    // Ctrl/Cmd+Shift+C stays with the global "copy the whole result" shortcut.
    if (mod && !event.shiftKey && event.key.toLowerCase() === "c" && range) {
      event.preventDefault();
      event.stopPropagation();
      copySelection(false);
      return;
    }

    if (mod && !event.shiftKey && event.key.toLowerCase() === "a") {
      event.preventDefault();
      event.stopPropagation();
      selection.selectAll();
      return;
    }

    // Not stopped: an open context menu closes on the same key.
    if (event.key === "Escape" && range) {
      selection.clear();
      return;
    }

    // Ctrl/Cmd + Alt + arrows is the global page-navigation shortcut; leave it be.
    if (event.altKey) return;

    const deltas: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const delta = deltas[event.key];
    if (delta) {
      event.preventDefault();
      event.stopPropagation();
      const next = selection.moveFocus(delta[0], delta[1], event.shiftKey);
      revealCell(next.row, next.col);
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      event.stopPropagation();
      const lastRow = result.rows.length - 1;
      const lastCol = result.columns.length - 1;
      const row = mod ? (event.key === "Home" ? 0 : lastRow) : (selection.focus?.row ?? 0);
      const col = event.key === "Home" ? 0 : lastCol;
      const next = selection.focusCell({ row, col }, event.shiftKey);
      revealCell(next.row, next.col);
    }
  }

  function handleMouseDown(event: MouseEvent<HTMLTableSectionElement>) {
    if (event.button !== 0) return;
    const position = resolveCellPosition(event.target);
    if (!position) return;
    // Keep the browser from starting a native text drag.
    event.preventDefault();
    selection.beginDrag(position, { extend: event.shiftKey });
    tableRef.current?.focus();
  }

  function handleMouseOver(event: MouseEvent<HTMLTableSectionElement>) {
    const position = resolveCellPosition(event.target);
    // No-op unless a drag is in progress.
    if (position) selection.extendTo(position);
  }

  function handleContextMenu(event: MouseEvent<HTMLTableSectionElement>) {
    const position = resolveCellPosition(event.target);
    if (!position) return;
    // The native menu is suppressed app-wide by a window listener, so stop the
    // event here and open our own menu instead.
    event.preventDefault();
    event.stopPropagation();
    if (!range || !isInRange(range, position.row, position.col)) selection.selectCell(position);
    tableRef.current?.focus();
    setMenuPosition({ x: event.clientX, y: event.clientY });
  }

  return (
    <>
      <table
        ref={tableRef}
        role="grid"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="min-w-full border-separate border-spacing-0 select-none text-[12px] outline-none"
      >
        <thead className="sticky top-0 bg-[hsl(var(--panel))]">
          <tr>
            {queryResult.columns.map((column, columnIndex) => (
              <th
                key={column}
                onClick={() => {
                  selection.selectColumn(columnIndex);
                  tableRef.current?.focus();
                }}
                className="cursor-pointer border-b border-r border-border px-2 py-1.5 text-left font-semibold text-foreground"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody
          onMouseDown={handleMouseDown}
          onMouseOver={handleMouseOver}
          onContextMenu={handleContextMenu}
        >
          {/* Spacer rows stand in for everything outside the window, so the
              scrollbar and the sticky header keep behaving normally. */}
          {paddingTop > 0 ? (
            <tr aria-hidden="true">
              <td colSpan={queryResult.columns.length} style={{ height: `${paddingTop}px` }} />
            </tr>
          ) : null}
          {virtualRows.map((virtualRow) => {
            const rowIndex = virtualRow.index;
            const cells = queryResult.rows[rowIndex];
            if (!cells) return null;
            const rowInRange = range !== null && rowIndex >= range.top && rowIndex <= range.bottom;
            return (
              <DataGridRow
                key={virtualRow.key}
                cells={cells}
                measureRef={rowVirtualizer.measureElement}
                rowIndex={rowIndex}
                // An empty range (from > to) means "nothing selected in this row".
                selectedFrom={rowInRange ? range.left : 1}
                selectedTo={rowInRange ? range.right : 0}
                focusedColumn={focus?.row === rowIndex ? focus.col : -1}
              />
            );
          })}
          {paddingBottom > 0 ? (
            <tr aria-hidden="true">
              <td colSpan={queryResult.columns.length} style={{ height: `${paddingBottom}px` }} />
            </tr>
          ) : null}
        </tbody>
      </table>
      {menuPosition ? (
        <CellContextMenu
          x={menuPosition.x}
          y={menuPosition.y}
          onClose={() => setMenuPosition(null)}
          onCopy={() => copySelection(false)}
          onCopyWithHeaders={() => copySelection(true)}
          onSelectAll={selection.selectAll}
        />
      ) : null}
    </>
  );
}
