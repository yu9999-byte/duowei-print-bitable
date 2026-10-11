import type { PrintJob } from "./print-job.ts";
import {
  commitBatchPrintSession,
  summarizeBatch,
  validateBatchRecordIds,
  type BatchPrintSession,
} from "./batch-print-session.ts";

export type PreparedBatchCandidate<TRendered> = {
  job: PrintJob;
  session: BatchPrintSession;
  rendered: TRendered;
  previewHtml: string;
};

export type PrepareBatchCandidateOptions<TRendered> = {
  currentSession: BatchPrintSession;
  requestedRecordIds: readonly string[];
  loadJob: (recordIds: readonly string[]) => Promise<PrintJob>;
  assertCurrent: () => Promise<void>;
  renderJob: (job: PrintJob) => Promise<TRendered>;
  composeRendered: (rendered: TRendered) => string;
  templateId?: string | null;
};

/**
 * Builds a complete batch workspace without mutating the committed workspace.
 * Callers may replace their current job/session/rendered preview only after this
 * promise resolves. Read, context and render failures therefore have no partial
 * candidate to commit.
 */
export async function prepareBatchCandidate<TRendered>(
  options: PrepareBatchCandidateOptions<TRendered>,
): Promise<PreparedBatchCandidate<TRendered>> {
  const validation = validateBatchRecordIds(options.requestedRecordIds);
  if (!validation.ok) throw new Error(validation.message);
  const requestedRecordIds = validation.recordIds;
  const job = await options.loadJob(requestedRecordIds);
  await options.assertCurrent();

  if (job.source.recordIds.length !== requestedRecordIds.length
    || job.source.recordIds.some((recordId, index) => recordId !== requestedRecordIds[index])) {
    throw new Error("批量读取结果与所选记录不一致；未更改当前打印批次");
  }

  const committed = commitBatchPrintSession(options.currentSession, {
    recordIds: requestedRecordIds,
    summaries: summarizeBatch(job),
    templateId: options.templateId,
  });
  if (!committed.ok) throw new Error(committed.message);

  const rendered = await options.renderJob(job);
  await options.assertCurrent();

  return {
    job,
    session: committed.session,
    rendered,
    previewHtml: options.composeRendered(rendered),
  };
}
