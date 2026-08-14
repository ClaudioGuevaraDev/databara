import { useResults } from "../../workspace/workspaceCore";
import { ResultsPanel } from "./ResultsPanel";

export function ResultsDock() {
  const results = useResults();

  if (!results.resultsOpen) return null;

  return (
    <ResultsPanel
      activeTab={results.resultTab}
      details={results.details}
      queryError={results.queryError}
      queryPagination={results.queryPagination}
      queryResult={results.queryResult}
      queryState={results.queryState}
      onCopyCells={results.copyCells}
      onCopyJson={results.copyJson}
      onCopySchema={results.copySchema}
      onDownload={results.downloadResults}
      onPageChange={results.goToQueryPage}
      onPageSizeChange={results.setQueryPageSize}
      onTabChange={results.selectResultTab}
      onViewModeChange={results.selectResultViewMode}
      viewMode={results.resultViewMode}
    />
  );
}
