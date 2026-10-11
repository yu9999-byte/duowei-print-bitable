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

test("UT-BATCH-12: 51 requested records are rejected before load, context checks, or render", async () => {
  const requestedRecordIds = Array.from({ length: 51 }, (_, index) => `record-${index + 1}`);
  let loadCalls = 0;
  let contextChecks = 0;
  let renderCalls = 0;

  await assert.rejects(
    prepareBatchCandidate({
      currentSession: createSinglePrintSession("host"),
      requestedRecordIds,
      loadJob: async () => {
        loadCalls += 1;
        return printJob(requestedRecordIds);
      },
      assertCurrent: async () => { contextChecks += 1; },
      renderJob: async () => {
        renderCalls += 1;
        return { recordIds: requestedRecordIds, pages: [] };
      },
      composeRendered: (rendered: Rendered) => rendered.pages.join("\n"),
    } as Parameters<typeof prepareBatchCandidate<Rendered>>[0]),
    { message: /50/ },
  );

  assert.equal(loadCalls, 0);
  assert.equal(contextChecks, 0);
  assert.equal(renderCalls, 0);
});

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
      requestedRecordIds: ["new-1", "new-2", "new-3"],
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
    requestedRecordIds: ["new-1", "new-2", "new-3"],
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
      requestedRecordIds: ["candidate"],
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
      requestedRecordIds: ["stale"],
      loadJob: async () => printJob(["stale"]),
      assertCurrent: async () => { throw new Error("context changed"); },
      renderJob: async () => ({ recordIds: ["stale"], pages: ["stale"] }),
      composeRendered: (rendered: Rendered) => rendered.pages.join("\n"),
    }),
    { message: "context changed" },
  );
});

test("IT-BATCH-RECOVERY-04: mismatched load results are rejected before render", async () => {
  const oldSessionResult = commitBatchPrintSession(createSinglePrintSession("host"), {
    recordIds: ["old-1", "old-2"],
    summaries: [
      { recordId: "old-1", label: "old-1" },
      { recordId: "old-2", label: "old-2" },
    ],
  });
  assert.equal(oldSessionResult.ok, true);
  if (!oldSessionResult.ok) return;
  let renderCalls = 0;

  for (const loadedIds of [
    ["new-2", "new-1", "new-3"],
    ["new-1", "new-2"],
  ]) {
    await assert.rejects(
      prepareBatchCandidate({
        currentSession: oldSessionResult.session,
        requestedRecordIds: ["new-1", "new-2", "new-3"],
        loadJob: async () => printJob(loadedIds),
        assertCurrent: async () => undefined,
        renderJob: async () => {
          renderCalls += 1;
          return { recordIds: [], pages: [] };
        },
        composeRendered: (rendered: Rendered) => rendered.pages.join("\n"),
      }),
      { message: /读取结果与所选记录不一致/ },
    );
  }

  assert.equal(renderCalls, 0);
  assert.deepEqual(oldSessionResult.session.committedRecordIds, ["old-1", "old-2"]);
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
