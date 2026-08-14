import { type KeyboardEvent, type MouseEvent, useCallback, useRef, useState } from "react";
import { cn } from "../../../lib/utils";
import { useI18n } from "../../i18n/I18nContext";
import { buildSelectionTsv, countCells, isInRange } from "../../query/copySelection";
import type { QueryResult } from "../../types";
import { EmptyPanel } from "../ui";
import { CellContextMenu } from "./CellContextMenu";
import { useCellSelection } from "./useCellSelection";

export function DataGrid({
  queryResult,
  onCopyCells,
}: {
  queryResult: QueryResult | null;
  onCopyCells?: (text: string, cellCount: number) => void;
}) {
  const { t } = useI18n();
  const tableRef = useRef<HTMLTableElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const selection = useCellSelection({
    resultId: queryResult?.id ?? null,
    rowCount: queryResult?.rows.length ?? 0,
    colCount: queryResult?.columns.length ?? 0,
  });
  const { range } = selection;

  // Keyboard navigation can walk outside the scrolled viewport of the results
  // panel (the scroller is the parent element, not the table).
  const revealCell = useCallback((row: number, col: number) => {
    tableRef.current
      ?.querySelector(`[data-cell="${row}-${col}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, []);

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

  function handleContextMenu(event: MouseEvent<HTMLTableCellElement>, row: number, col: number) {
    // The native menu is suppressed app-wide by a window listener, so stop the
    // event here and open our own menu instead.
    event.preventDefault();
    event.stopPropagation();
    if (!range || !isInRange(range, row, col)) selection.selectCell({ row, col });
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
        <tbody>
          {queryResult.rows.map((row, rowIndex) => (
            <tr
              key={`${queryResult.id}-${rowIndex}`}
              className="odd:bg-[hsl(var(--panel-soft)/0.28)]"
            >
              {row.map((cell, cellIndex) => {
                const selected = selection.isSelected(rowIndex, cellIndex);
                return (
                  <td
                    key={`${rowIndex}-${cellIndex}`}
                    role="gridcell"
                    aria-selected={selected}
                    data-cell={`${rowIndex}-${cellIndex}`}
                    title={cell ?? ""}
                    onMouseDown={(event) => {
                      if (event.button !== 0) return;
                      // Keep the browser from starting a native text drag.
                      event.preventDefault();
                      selection.beginDrag(
                        { row: rowIndex, col: cellIndex },
                        { extend: event.shiftKey },
                      );
                      tableRef.current?.focus();
                    }}
                    onMouseEnter={() => selection.extendTo({ row: rowIndex, col: cellIndex })}
                    onContextMenu={(event) => handleContextMenu(event, rowIndex, cellIndex)}
                    className={cn(
                      "max-w-64 truncate border-b border-r border-border px-2 py-1.5 text-foreground",
                      selected && "bg-[hsl(var(--primary)/0.18)]",
                      selection.isFocused(rowIndex, cellIndex) &&
                        "outline outline-1 -outline-offset-1 outline-[hsl(var(--primary))]",
                    )}
                  >
                    {cell ?? "NULL"}
                  </td>
                );
              })}
            </tr>
          ))}
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
