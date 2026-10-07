import type { BatchPrintSession, BatchRecordSummary } from "../core/batch-print-session.ts";
import type { WorkspaceMode } from "../core/workspace.ts";
import { shouldShowBatchReadRetry } from "./batch-read-feedback.ts";

export type BatchWorkspaceActionInput = {
  busy: boolean;
  retryAvailable: boolean;
  workspaceMode: WorkspaceMode;
  templateLoaded: boolean;
  hasRenderedPages: boolean;
  session: BatchPrintSession;
};

export type BatchWorkspaceActionState = {
  isBatchMode: boolean;
  recordIds: string[];
  summaries: BatchRecordSummary[];
  retryVisible: boolean;
  outputDisabled: boolean;
  selectLabel: string;
  printLabel: string;
  exportPdfLabel: string;
};

/**
 * Produces the complete batch action/view state from the last committed
 * session. Candidate reads never enter this model until they have loaded and
 * rendered successfully, so a timeout can disable actions temporarily without
 * erasing the printable batch already on screen.
 */
export function getBatchWorkspaceActionState(
  input: BatchWorkspaceActionInput,
): BatchWorkspaceActionState {
  const isBatchMode = input.session.mode === "batch";
  const recordIds = [...input.session.committedRecordIds];
  const summaries = input.session.summaries.map((item) => ({ ...item }));
  const count = recordIds.length;

  return {
    isBatchMode,
    recordIds,
    summaries,
    retryVisible: shouldShowBatchReadRetry(input.retryAvailable, input.busy),
    outputDisabled: input.busy
      || input.workspaceMode !== "preview"
      || !input.templateLoaded
      || !input.hasRenderedPages,
    selectLabel: isBatchMode ? "重新选择" : "选择打印记录",
    printLabel: isBatchMode ? `打印 ${count} 条` : "打印",
    exportPdfLabel: isBatchMode ? `导出 ${count} 条 PDF` : "导出 PDF",
  };
}
