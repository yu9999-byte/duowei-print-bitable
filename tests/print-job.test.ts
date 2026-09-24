import assert from "node:assert/strict";
import test from "node:test";
import { buildPrintJob } from "../src/core/print-job.ts";

const baseInput = {
  source: { baseId: "base-test", tableId: "table-orders" },
  table: { name: "订单", fields: [{ id: "fld-name", name: "客户", type: "text" }] },
  records: [
    { recordId: "rec-1", values: { 客户: "甲" } },
    { recordId: "rec-2", values: { 客户: "乙" } },
    { recordId: "rec-3", values: { 客户: "丙", 明细: [{ 产品: "纸" }] } },
  ],
  generatedAt: "2026-09-21T10:00:00.000Z",
};

test("SPEC-BATCH-01: print job follows selected order, independent of fetch order", () => {
  const job = buildPrintJob({ ...baseInput, selectedIds: ["rec-3", "rec-1", "rec-2"] });
  assert.deepEqual(job.source.recordIds, ["rec-3", "rec-1", "rec-2"]);
  assert.deepEqual(job.documents.map((doc) => doc.recordId), ["rec-3", "rec-1", "rec-2"]);
  assert.deepEqual(job.documents[0].values.明细, [{ 产品: "纸" }]);
});

test("SPEC-BATCH-01: repeated selection does not print a record twice", () => {
  const job = buildPrintJob({ ...baseInput, selectedIds: ["rec-2", "rec-2", "rec-1"] });
  assert.deepEqual(job.documents.map((doc) => doc.recordId), ["rec-2", "rec-1"]);
});

test("SPEC-CTX-02: empty selection cannot silently print the first record", () => {
  assert.throws(
    () => buildPrintJob({ ...baseInput, selectedIds: [] }),
    { message: "请先在当前表选中至少一条记录" },
  );
});

test("SPEC-BATCH-01: missing selected record cannot produce a partial batch", () => {
  assert.throws(
    () => buildPrintJob({ ...baseInput, selectedIds: ["rec-1", "rec-missing"] }),
    { message: "所选记录读取不完整：rec-missing" },
  );
});

test("SPEC-CTX-01: duplicate fetched IDs cannot overwrite a selected record", () => {
  assert.throws(
    () => buildPrintJob({
      ...baseInput,
      selectedIds: ["rec-1"],
      records: [...baseInput.records, { recordId: "rec-1", values: { 客户: "不同值" } }],
    }),
    { message: "记录读取结果包含重复 ID：rec-1" },
  );
});

test("SPEC-CTX-01: unselected fetched records do not enter the job", () => {
  const job = buildPrintJob({ ...baseInput, selectedIds: ["rec-1"] });
  assert.deepEqual(job.documents.map((doc) => doc.recordId), ["rec-1"]);
});

test("SPEC-BATCH-01: a built job keeps its values when the fetched response changes", () => {
  const records = [{ recordId: "rec-1", values: { 客户: "原值" } }];
  const job = buildPrintJob({ ...baseInput, selectedIds: ["rec-1"], records });
  records[0].values.客户 = "后来修改";
  assert.equal(job.documents[0].values.客户, "原值");
});
