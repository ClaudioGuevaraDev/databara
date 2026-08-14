import { Braces, Columns3, Loader2, Table2 } from "lucide-react";
import { useState } from "react";
import { cn } from "../../../lib/utils";
import { BOTTOM_PANEL_HEIGHT_MAX, BOTTOM_PANEL_HEIGHT_MIN } from "../../databaraService";
import { useI18n } from "../../i18n/I18nContext";
import type {
  DatabaseObjectDetails,
  QueryPagination,
  QueryResult,
  QueryState,
  ResultExportFormat,
  ResultExportScope,
  ResultPanelTab,
  ResultViewMode,
} from "../../types";
import { useSettings } from "../../workspace/workspaceCore";
import { EmptyPanel, ResizeHandle } from "../ui";
import { ColumnsView } from "./ColumnsView";
import { DataGrid } from "./DataGrid";
import { JsonView } from "./JsonView";
import { ResultsFooter } from "./ResultsFooter";
import { ResultsStatusLine } from "./ResultsStatusLine";
import { ResultsViewBar } from "./ResultsViewBar";
import { SchemaView } from "./SchemaView";

export function ResultsPanel({
  activeTab,
  details,
  onCopyCells,
  onCopyJson,
  onCopySchema,
  onDownload,
  onPageChange,
  onPageSizeChange,
  onTabChange,
  onViewModeChange,
  queryError,
  queryPagination,
  queryResult,
  queryState,
  viewMode,
}: {
  activeTab: ResultPanelTab;
  details: DatabaseObjectDetails | null;
  onCopyCells: (text: string, cellCount: number) => void;
  onCopyJson: () => void;
  onCopySchema: () => void;
  onDownload: (format: ResultExportFormat, scope: ResultExportScope) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onTabChange: (tab: ResultPanelTab) => void;
  onViewModeChange: (mode: ResultViewMode) => void;
  queryError: string | null;
  queryPagination: QueryPagination | null;
  queryResult: QueryResult | null;
  queryState: QueryState;
  viewMode: ResultViewMode;
}) {
  const { t } = useI18n();
  const { settings, setBottomPanelHeight } = useSettings();
  // Live height while dragging; persisted only on release (see WorkspaceShell).
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const height = dragHeight ?? settings.bottomPanelHeight.height;

  const tabs = [
    { id: "results" as const, icon: Table2, label: t("results.tabs.results") },
    { id: "columns" as const, icon: Columns3, label: t("results.tabs.columns") },
    { id: "schema" as const, icon: Braces, label: t("results.tabs.schema") },
  ];

  const hasGrid = Boolean(queryResult && queryResult.columns.length > 0);

  // The dedicated view bar carries the Table/JSON switch and only exists for the Results
  // tab. Hidden while running/erroring or with nothing to act on, so it never shows over a
  // blank panel. Columns/Schema render their content directly under the tab strip.
  const showViewBar =
    activeTab === "results" && queryState !== "running" && hasGrid && queryState !== "error";

  // The footer already reports row/page counts, so the status line is only useful
  // for command messages (no pagination) and errors — not redundant read summaries.
  const showStatusLine =
    activeTab === "results" &&
    (queryState === "error" || (queryState === "success" && !queryPagination));
  const statusMessage =
    queryState === "error"
      ? (queryError ?? t("results.queryFailed"))
      : (queryResult?.message ?? t("results.done"));

  return (
    <section
      className="chrome-panel relative flex shrink-0 flex-col border-t border-border"
      style={{ height }}
    >
      <ResizeHandle
        axis="y"
        inverted
        ariaLabel={t("results.resize")}
        value={height}
        min={BOTTOM_PANEL_HEIGHT_MIN}
        max={BOTTOM_PANEL_HEIGHT_MAX}
        onResize={setDragHeight}
        onCommit={(next) => {
          setBottomPanelHeight(next);
          setDragHeight(null);
        }}
        className="absolute inset-x-0 top-0 -translate-y-1/2"
      />
      <div className="flex h-9 items-center border-b border-border">
        <div className="flex h-full items-center">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  "relative flex h-full shrink-0 items-center gap-1.5 whitespace-nowrap border-r border-border px-3 text-[12px]",
                  active
                    ? "bg-background text-foreground before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-primary before:shadow-[0_0_12px_hsl(var(--primary)/0.6)] before:content-['']"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon size={14} className={cn("shrink-0", active && "text-primary")} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
      {showViewBar ? (
        <ResultsViewBar
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          onDownload={onDownload}
        />
      ) : null}
      {showStatusLine ? (
        <ResultsStatusLine queryState={queryState} message={statusMessage} />
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {queryState === "running" ? (
          <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
            <Loader2 size={16} className="animate-spin text-primary" />
            {t("results.running")}
          </div>
        ) : activeTab === "columns" ? (
          <ColumnsView details={details} />
        ) : activeTab === "schema" ? (
          <SchemaView details={details} onCopy={onCopySchema} />
        ) : queryState === "error" ? (
          <pre className="h-full w-full overflow-auto whitespace-pre-wrap p-3 font-mono text-[12px] text-destructive">
            {queryError ?? t("results.queryFailed")}
          </pre>
        ) : hasGrid ? (
          viewMode === "json" ? (
            <JsonView queryResult={queryResult} onCopy={onCopyJson} />
          ) : (
            <DataGrid queryResult={queryResult} onCopyCells={onCopyCells} />
          )
        ) : queryResult ? (
          <EmptyPanel text={queryResult.message} />
        ) : (
          <DataGrid queryResult={null} />
        )}
      </div>
      {activeTab === "results" && queryPagination ? (
        <ResultsFooter
          pagination={queryPagination}
          durationMs={queryResult?.durationMs ?? 0}
          isRunning={queryState === "running"}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      ) : null}
    </section>
  );
}
