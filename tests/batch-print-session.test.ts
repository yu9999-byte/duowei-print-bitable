import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_BATCH_RECORDS,
  batchSessionRecordLabel,
  commitBatchPrintSession,
  createSinglePrintSession,
  exitBatchPrintSession,
  shouldExitBatchOnTemplateSwitch,
  summarizeBatch,
} from "../src/core/batch-print-session.ts";
import type { PrintJob } from "../src/core/print-job.ts";

test("UT-BATCH-07: summaries use the marked primary field even when it is not first", () => {
  const job = {
    table: { name: "订单", fields: [
      { id: "customer", name: "客户", type: "1" },
      { id: "number", name: "订单编号", type: "1", isPrimary: true },
    ] },
    documents: [
      { recordId: "rec-1", values: { 客户: "甲公司", 订单编号: "PO-0001" } },
      { recordId: "rec-2", values: { 客户: "乙公司", 订单编号: "" } },
    ],
  } as PrintJob;
  assert.deepEqual(summarizeBatch(job), [
    { recordId: "rec-1", label: "PO-0001" },
    { recordId: "rec-2", label: "rec-2" },
  ]);
});

test("UT-BATCH-07: legacy jobs without primary metadata fall back to a readable field", () => {
  const job = {
    table: { name: "订单", fields: [
      { id: "link", name: "明细", type: "18", isLink: true },
      { id: "number", name: "订单编号", type: "1" },
    ] },
    documents: [{ recordId: "rec-1", values: { 订单编号: "PO-0001" } }],
  } as PrintJob;
  assert.deepEqual(summarizeBatch(job), [{ recordId: "rec-1", label: "PO-0001" }]);
});

test("SPEC-BATCH-04: empty candidate does not alter the committed single session", () => {
  const current = createSinglePrintSession("rec-1");
  const result = commitBatchPrintSession(current, { recordIds: [], summaries: [] });
  assert.equal(result.ok, false);
  assert.equal(current.mode, "single");
  assert.deepEqual(current.committedRecordIds, ["rec-1"]);
});

test("SPEC-BATCH-05: a valid candidate commits in its supplied order with summaries", () => {
  const current = createSinglePrintSession("rec-1");
  const result = commitBatchPrintSession(current, {
    recordIds: ["rec-3", "rec-1", "rec-2"],
    summaries: [
      { recordId: "rec-1", label: "PO-0001" },
      { recordId: "rec-2", label: "PO-0002" },
      { recordId: "rec-3", label: "PO-0003" },
    ],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.session.mode, "batch");
    assert.deepEqual(result.session.committedRecordIds, ["rec-3", "rec-1", "rec-2"]);
    assert.deepEqual(result.session.summaries.map((item) => item.label), ["PO-0003", "PO-0001", "PO-0002"]);
    assert.equal(batchSessionRecordLabel(result.session), "已选 3 条");
  }
});

test("SPEC-BATCH-08: a batch session records the template that owns it", () => {
  const result = commitBatchPrintSession(createSinglePrintSession("rec-1"), {
    recordIds: ["rec-1", "rec-2"],
    summaries: [],
    templateId: "template-a",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.session.templateId, "template-a");
});

test("SPEC-BATCH-08: switching away from the owning template requires leaving batch", () => {
  const result = commitBatchPrintSession(createSinglePrintSession("rec-1"), {
    recordIds: ["rec-1", "rec-2"],
    summaries: [],
    templateId: "template-a",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(shouldExitBatchOnTemplateSwitch(result.session, "template-a"), false);
  assert.equal(shouldExitBatchOnTemplateSwitch(result.session, "template-b"), true);
  const single = exitBatchPrintSession(result.session);
  assert.equal(single.mode, "single");
  assert.equal(single.templateId, null);
});

test("SPEC-BATCH-06: the 51st unique record is rejected without truncation", () => {
  const current = createSinglePrintSession("rec-1");
  const recordIds = Array.from({ length: MAX_BATCH_RECORDS + 1 }, (_, index) => `rec-${index + 1}`);
  const result = commitBatchPrintSession(current, { recordIds, summaries: [] });
  assert.equal(result.ok, false);
  assert.match(result.message, /50/);
  assert.deepEqual(current.committedRecordIds, ["rec-1"]);
});

test("SPEC-BATCH-06: exactly 50 unique records are accepted", () => {
  const recordIds = Array.from({ length: MAX_BATCH_RECORDS }, (_, index) => `rec-${index + 1}`);
  const result = commitBatchPrintSession(createSinglePrintSession("rec-1"), {
    recordIds, summaries: [],
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.session.committedRecordIds.length, 50);
});

test("SPEC-BATCH-07: exiting a batch returns to the host record without carrying batch IDs", () => {
  const current = commitBatchPrintSession(createSinglePrintSession("rec-1"), {
    recordIds: ["rec-2", "rec-3"], summaries: [],
  });
  assert.equal(current.ok, true);
  if (current.ok) {
    const single = exitBatchPrintSession(current.session);
    assert.equal(single.mode, "single");
    assert.deepEqual(single.committedRecordIds, ["rec-1"]);
    assert.equal(batchSessionRecordLabel(single), "当前记录");
  }
});
