import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type CellPosition,
  type CellRange,
  isInRange,
  normalizeRange,
} from "../../query/copySelection";

// Spreadsheet-style cell selection for the results grid. This is ephemeral view
// state (it dies with the rendered page of rows), so it stays local to DataGrid
// instead of living in the workspace provider. `anchor` is the corner the user
// started from and `focus` the one that moves — the selected block is the
// rectangle between them.
export function useCellSelection({
  resultId,
  rowCount,
  colCount,
}: {
  resultId: string | null;
  rowCount: number;
  colCount: number;
}) {
  const [anchor, setAnchor] = useState<CellPosition | null>(null);
  const [focus, setFocus] = useState<CellPosition | null>(null);
  const [lastResultId, setLastResultId] = useState(resultId);
  const draggingRef = useRef(false);

  // A new result (re-run, page change, another SQL tab) invalidates the indices.
  // Adjusting state during render is React's recommended alternative to an
  // effect here — it drops the stale selection before anything is painted.
  if (resultId !== lastResultId) {
    setLastResultId(resultId);
    setAnchor(null);
    setFocus(null);
  }

  const range: CellRange | null = useMemo(
    () => (anchor && focus ? normalizeRange(anchor, focus) : null),
    [anchor, focus],
  );

  const clear = useCallback(() => {
    setAnchor(null);
    setFocus(null);
  }, []);

  // The drag ends wherever the pointer is released, including outside the grid.
  useEffect(() => {
    const stopDragging = () => {
      draggingRef.current = false;
    };
    window.addEventListener("mouseup", stopDragging);
    return () => window.removeEventListener("mouseup", stopDragging);
  }, []);

  const clamp = useCallback(
    (position: CellPosition): CellPosition => ({
      row: Math.min(Math.max(position.row, 0), Math.max(rowCount - 1, 0)),
      col: Math.min(Math.max(position.col, 0), Math.max(colCount - 1, 0)),
    }),
    [colCount, rowCount],
  );

  const selectCell = useCallback(
    (position: CellPosition, options?: { extend?: boolean }) => {
      const next = clamp(position);
      setFocus(next);
      if (!options?.extend || !anchor) setAnchor(next);
    },
    [anchor, clamp],
  );

  const beginDrag = useCallback(
    (position: CellPosition, options?: { extend?: boolean }) => {
      draggingRef.current = true;
      selectCell(position, options);
    },
    [selectCell],
  );

  const extendTo = useCallback(
    (position: CellPosition) => {
      if (!draggingRef.current || !anchor) return;
      setFocus(clamp(position));
    },
    [anchor, clamp],
  );

  const moveFocus = useCallback(
    (deltaRow: number, deltaCol: number, extend: boolean) => {
      const from = focus ?? { row: 0, col: 0 };
      // With no selection yet, the first arrow press just lands on the top-left
      // cell rather than stepping away from it.
      const next = clamp(focus ? { row: from.row + deltaRow, col: from.col + deltaCol } : from);
      selectCell(next, { extend });
      return next;
    },
    [clamp, focus, selectCell],
  );

  const focusCell = useCallback(
    (position: CellPosition, extend: boolean) => {
      const next = clamp(position);
      selectCell(next, { extend });
      return next;
    },
    [clamp, selectCell],
  );

  const selectColumn = useCallback(
    (col: number) => {
      if (rowCount === 0) return;
      setAnchor({ row: 0, col });
      setFocus({ row: rowCount - 1, col });
    },
    [rowCount],
  );

  const selectAll = useCallback(() => {
    if (rowCount === 0 || colCount === 0) return;
    setAnchor({ row: 0, col: 0 });
    setFocus({ row: rowCount - 1, col: colCount - 1 });
  }, [colCount, rowCount]);

  const isSelected = useCallback(
    (row: number, col: number) => (range ? isInRange(range, row, col) : false),
    [range],
  );

  const isFocused = useCallback(
    (row: number, col: number) => focus?.row === row && focus?.col === col,
    [focus],
  );

  return {
    range,
    focus,
    beginDrag,
    clear,
    extendTo,
    focusCell,
    isFocused,
    isSelected,
    moveFocus,
    selectCell,
    selectAll,
    selectColumn,
  };
}
