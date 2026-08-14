import { ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "../../i18n/I18nContext";
import { QUERY_PAGE_SIZES, type QueryPagination } from "../../types";
import { IconButton } from "../ui";

export function ResultsFooter({
  pagination,
  durationMs,
  isRunning,
  onPageChange,
  onPageSizeChange,
}: {
  pagination: QueryPagination;
  durationMs: number;
  isRunning: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const { t } = useI18n();
  const { page, pageSize, totalRows, pageSizeLocked } = pagination;
  // The exact total comes from a COUNT that can scan the whole result set, so the
  // rows are shown before it resolves. Until then the totals read as pending and
  // the controls that need bounds stay disabled — for the fraction of a second it
  // usually takes, or for as long as a big table needs.
  const counting = totalRows === null;
  const pending = "…";
  const totalLabel = counting ? pending : totalRows.toLocaleString();
  const totalPages = counting ? page + 1 : Math.max(1, Math.ceil(totalRows / pageSize));
  const firstRow = !counting && totalRows === 0 ? 0 : page * pageSize + 1;
  const lastRowLabel = counting
    ? pending
    : Math.min((page + 1) * pageSize, totalRows).toLocaleString();
  // The locked size (from the user's LIMIT) may not be one of the preset options.
  const sizeOptions = (QUERY_PAGE_SIZES as readonly number[]).includes(pageSize)
    ? QUERY_PAGE_SIZES
    : [pageSize, ...QUERY_PAGE_SIZES];

  return (
    <div className="chrome-panel flex h-9 shrink-0 items-center justify-between border-t border-border px-3 text-[12px] text-muted-foreground">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex items-center gap-2 whitespace-nowrap">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
          <span className="tabular-nums text-foreground">{totalLabel}</span> {t("results.rowsWord")}
        </span>
        <span className="text-border">·</span>
        <span className="whitespace-nowrap tabular-nums">
          {durationMs} {t("results.ms")}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="whitespace-nowrap">
          {t("results.rowsWord")} {firstRow.toLocaleString()}–{lastRowLabel} {t("results.of")}{" "}
          <span className="text-foreground">{totalLabel}</span>
        </span>
        <span className="text-border">·</span>
        <label className="flex items-center gap-1.5 whitespace-nowrap">
          {t("results.rowsLabel")}
          <select
            value={pageSize}
            disabled={isRunning || pageSizeLocked || counting}
            title={pageSizeLocked ? t("results.pageSizeLocked") : undefined}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-7 rounded border border-border bg-background px-1.5 text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <IconButton
          title={t("results.previousPage")}
          disabled={isRunning || page <= 0}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft size={16} />
        </IconButton>
        <span className="whitespace-nowrap tabular-nums">
          {t("results.pageWord")} <span className="text-foreground">{page + 1}</span>{" "}
          {t("results.of")} {counting ? pending : totalPages}
        </span>
        <IconButton
          title={t("results.nextPage")}
          disabled={isRunning || counting || page >= totalPages - 1}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight size={16} />
        </IconButton>
      </div>
    </div>
  );
}
