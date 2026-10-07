import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareBatchCandidate,
  type PreparedBatchCandidate,
} from "../src/core/batch-candidate-transaction.ts";
import {
  commitBatchPrintSession,
  createSinglePrintSession,
  type BatchPrintSession,
} from "../src/core/batch-print-session.ts";
import type { PrintJob } from "../src/core/print-job.ts";
import { BitableReadTimeoutError, withReadTimeout } from "../src/host/read-timeout.ts";

type Rendered = { recordIds: string[]; pages: string[] };

test("IT-BATCH-RECOVERY-02: a timed-out candidate cannot replace the committed printable batch", async () => {
  const oldJob = printJob(["old-1", "old-2"]);
  const oldSessionResult = commitBatchPrintSession(createSinglePrintSession("host"), {
    recordIds: oldJob.source.recordIds,
    summaries: oldJob.documents.map((item) => ({ recordId: item.recordId, label: item.recordId })),
  });
  assert.equal(oldSessionResult.ok, true);
  if (!oldSessionResult.ok) return;

  const oldRendered: Rendered = {
    recordIds: [...oldJob.source.recordIds],
    pages: ["old page 1", "old page 2"],
  };
  let committed: PreparedBatchCandidate<Rendered> = {
    job: oldJob,
    session: oldSessionResult.session,
    rendered: oldRendered,
    previewHtml: "old page 1\nold page 2",
  };
  let resolveLate: ((job: PrintJob) => void) | undefined;
  let renderCalls = 0;

  await assert.rejects(
    prepareBatchCandidate({
      currentSession: committed.session,
      loadJob: () => withReadTimeout(
        "读取候选批次",
        new Promise<PrintJob>((resolve) => { resolveLate = resolve; }),
        10,
      ),
      assertCurrent: async () => undefined,
      renderJob: async () => {
        renderCalls += 1;
        return { recordIds: ["unexpected"], pages: ["unexpected"] };
      },
      composeRendered: (rendered) => rendered.pages.join("\n"),
    }),
    BitableReadTimeoutError,
  );

  assert.equal(renderCalls, 0);
  assert.deepEqual(committed.job.source.recordIds, ["old-1", "old-2"]);
  assert.deepEqual(committed.session.committedRecordIds, ["old-1", "old-2"]);
  assert.deepEqual(committed.rendered.pages, ["old page 1", "old page 2"]);
  assert.equal(committed.previewHtml, "old page 1\nold page 2");

  const retry = await prepareBatchCandidate({
    currentSession: committed.session,
    loadJob: async () => printJob(["new-1", "new-2", "new-3"]),
    assertCurrent: async () => undefined,
    renderJob: async (job) => ({
      recordIds: [...job.source.recordIds],
      pages: job.source.recordIds.map((recordId) => `page ${recordId}`),
    }),
    composeRendered: (rendered) => rendered.pages.join("\n"),
  });
  committed = retry;

  assert.deepEqual(committed.job.source.recordIds, ["new-1", "new-2", "new-3"]);
  assert.deepEqual(committed.session.committedRecordIds, ["new-1", "new-2", "new-3"]);
  assert.equal(committed.previewHtml, "page new-1\npage new-2\npage new-3");

  resolveLate?.(printJob(["late-old-result"]));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(committed.job.source.recordIds, ["new-1", "new-2", "new-3"]);
  assert.deepEqual(committed.rendered.recordIds, ["new-1", "new-2", "new-3"]);
});

test("IT-BATCH-RECOVERY-03: render or context failure returns no partial candidate", async () => {
  const currentSession: BatchPrintSession = createSinglePrintSession("host");
  let contextChecks = 0;

  await assert.rejects(
    prepareBatchCandidate({
      currentSession,
      loadJob: async () => printJob(["candidate"]),
      assertCurrent: async () => { contextChecks += 1; },
      renderJob: async () => { throw new Error("candidate render failed"); },
      composeRendered: (rendered: Rendered) => rendered.pages.join("\n"),
    }),
    { message: "candidate render failed" },
  );
  assert.equal(contextChecks, 1);

  await assert.rejects(
    prepareBatchCandidate({
      currentSession,
      loadJob: async () => printJob(["stale"]),
      assertCurrent: async () => { throw new Error("context changed"); },
      renderJob: async () => ({ recordIds: ["stale"], pages: ["stale"] }),
      composeRendered: (rendered: Rendered) => rendered.pages.join("\n"),
    }),
    { message: "context changed" },
  );
});

function printJob(recordIds: string[]): PrintJob {
  return {
    source: { baseId: "base", tableId: "table", recordIds },
    table: {
      name: "订单",
      fields: [{ id: "number", name: "订单编号", type: "1", isPrimary: true }],
    },
    documents: recordIds.map((recordId) => ({
      recordId,
      values: { 订单编号: recordId },
    })),
    generatedAt: "2026-10-06T00:00:00.000Z",
  };
}
