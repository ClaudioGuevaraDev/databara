import { memo } from "react";

// Precomputed class combinations instead of `cn(...)` per cell: `cn` runs
// tailwind-merge, which tokenizes and conflict-resolves the whole string, and a
// single page can hold thousands of cells. Nothing here conflicts (the selected
// and focused variants only add properties the base doesn't set), so the
// combinations are just concatenations.
const CELL_BASE = "max-w-64 truncate border-b border-r border-border px-2 py-1.5 text-foreground";
const CELL_SELECTED = `${CELL_BASE} bg-[hsl(var(--primary)/0.18)]`;
const FOCUS_SUFFIX = " outline outline-1 -outline-offset-1 outline-[hsl(var(--primary))]";
// [selected][focused]
const CELL_CLASS = [
  [CELL_BASE, CELL_BASE + FOCUS_SUFFIX],
  [CELL_SELECTED, CELL_SELECTED + FOCUS_SUFFIX],
];

/**
 * One row of the results grid.
 *
 * Every prop is a primitive (or the stable row array from the query result), so
 * the memo comparison is cheap and exact: while dragging a selection, only the
 * rows whose selected range or focused column actually changed re-render.
 *
 * There are no per-cell event handlers — `DataGrid` delegates mouse events on
 * `<tbody>` and resolves the cell from `data-cell`.
 */
export const DataGridRow = memo(function DataGridRow({
  cells,
  focusedColumn,
  measureRef,
  rowIndex,
  selectedFrom,
  selectedTo,
}: {
  cells: (string | null)[];
  // -1 when no cell of this row is focused.
  focusedColumn: number;
  // The virtualizer's measuring ref; it reads the row index off `data-index`.
  measureRef?: (element: HTMLTableRowElement | null) => void;
  rowIndex: number;
  // Inclusive column range selected in this row; `selectedFrom > selectedTo`
  // means nothing in this row is selected.
  selectedFrom: number;
  selectedTo: number;
}) {
  return (
    <tr ref={measureRef} data-index={rowIndex} className="odd:bg-[hsl(var(--panel-soft)/0.28)]">
      {cells.map((cell, cellIndex) => {
        const selected = cellIndex >= selectedFrom && cellIndex <= selectedTo;
        return (
          <td
            key={cellIndex}
            role="gridcell"
            aria-selected={selected}
            data-cell={`${rowIndex}-${cellIndex}`}
            title={cell ?? ""}
            className={CELL_CLASS[selected ? 1 : 0][cellIndex === focusedColumn ? 1 : 0]}
          >
            {cell ?? "NULL"}
          </td>
        );
      })}
    </tr>
  );
});
