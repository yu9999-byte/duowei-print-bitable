import type { PrintJob } from "./print-job.ts";
import {
  commitBatchPrintSession,
  summarizeBatch,
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
  loadJob: () => Promise<PrintJob>;
  assertCurrent: () => Promise<void>;
  renderJob: (job: PrintJob) => Promise<TRendered>;
  composeRendered: (rendered: TRendered) => string;
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
  const job = await options.loadJob();
  await options.assertCurrent();

  const committed = commitBatchPrintSession(options.currentSession, {
    recordIds: job.source.recordIds,
    summaries: summarizeBatch(job),
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
