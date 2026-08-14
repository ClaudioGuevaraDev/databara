import type { QueryResult } from "../types";

/** A single cell address inside the result grid (page-local indices). */
export type CellPosition = { row: number; col: number };

/** An inclusive rectangular block of cells. */
export type CellRange = { top: number; left: number; bottom: number; right: number };

/** Orders the two corners of a drag/shift selection into a rectangle. */
export function normalizeRange(anchor: CellPosition, focus: CellPosition): CellRange {
  return {
    top: Math.min(anchor.row, focus.row),
    left: Math.min(anchor.col, focus.col),
    bottom: Math.max(anchor.row, focus.row),
    right: Math.max(anchor.col, focus.col),
  };
}

export function countCells(range: CellRange): number {
  return (range.bottom - range.top + 1) * (range.right - range.left + 1);
}

export function isInRange(range: CellRange, row: number, col: number): boolean {
  return row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;
}

// Spreadsheets read a tab-separated block as a grid, so a value that itself
// contains a tab, a newline or a quote has to be quoted (CSV rules) or it would
// spill into neighbouring cells. Plain values stay untouched — quoting every
// cell would make a single-cell copy useless for pasting elsewhere.
function escapeTsvCell(value: string): string {
  return /["\t\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Serializes a selected block as TSV. NULLs become empty cells (the grid still
 * *shows* "NULL"), matching what a spreadsheet expects on paste.
 */
export function buildSelectionTsv(
  result: QueryResult,
  range: CellRange,
  options: { includeHeaders: boolean },
): string {
  const top = Math.max(0, range.top);
  const left = Math.max(0, range.left);
  const bottom = Math.min(result.rows.length - 1, range.bottom);
  const right = Math.min(result.columns.length - 1, range.right);
  if (bottom < top || right < left) return "";

  const lines: string[] = [];
  if (options.includeHeaders) {
    lines.push(
      result.columns
        .slice(left, right + 1)
        .map(escapeTsvCell)
        .join("\t"),
    );
  }

  for (let row = top; row <= bottom; row += 1) {
    const cells: string[] = [];
    for (let col = left; col <= right; col += 1) {
      cells.push(escapeTsvCell(result.rows[row]?.[col] ?? ""));
    }
    lines.push(cells.join("\t"));
  }

  return lines.join("\n");
}
