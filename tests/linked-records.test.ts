import assert from "node:assert/strict";
import test from "node:test";
import { expandLinkedRecords, type LinkedTableReader } from "../src/core/linked-records.ts";

function reader(): LinkedTableReader {
  return {
    async getOrderedFields() {
      return [
        { id: "f1", name: "产品" },
        { id: "f2", name: "数量" },
        { id: "f3", name: "单价" },
        { id: "f4", name: "备注" },
        { id: "f5", name: "批次" },
        { id: "f6", name: "内部字段" },
      ];
    },
    async getCellText(recordId, fieldId) {
      const values: Record<string, Record<string, string>> = {
        r2: { f1: "鼠标", f2: "5", f3: "200", f4: "", f5: "B" },
        r1: { f1: "笔记本", f2: "2", f3: "5000", f4: "加急", f5: "A" },
      };
      if (!values[recordId]) throw new Error("missing:" + recordId);
      return values[recordId][fieldId] ?? "";
    },
  };
}

test("SPEC-LINK-01: linked rows preserve recordIds order and use first five ordered fields", async () => {
  const result = await expandLinkedRecords(
    { tableId: "table-lines", recordIds: ["r2", "r1"], text: "鼠标,笔记本" },
    reader(),
  );
  assert.deepEqual(result.columns, [
    { field: "产品", header: "产品" },
    { field: "数量", header: "数量" },
    { field: "单价", header: "单价" },
    { field: "备注", header: "备注" },
    { field: "批次", header: "批次" },
  ]);
  assert.deepEqual(result.rows.map((row) => row.产品), ["鼠标", "笔记本"]);
  assert.equal(result.rows[1].备注, "加急");
  assert.ok(!("内部字段" in result.rows[0]));
});

test("SPEC-LINK-03: an empty link produces columns and no fake rows", async () => {
  const result = await expandLinkedRecords(
    { tableId: "table-lines", recordIds: [], text: "" },
    reader(),
  );
  assert.equal(result.columns.length, 5);
  assert.deepEqual(result.rows, []);
});

test("SPEC-DATA-02: a missing linked record fails explicitly instead of returning a partial table", async () => {
  await assert.rejects(
    () => expandLinkedRecords(
      { tableId: "table-lines", recordIds: ["r1", "missing"], text: "" },
      reader(),
    ),
    { message: "关联记录读取失败：missing" },
  );
});

test("SPEC-LINK-01: duplicate linked record IDs are rejected instead of printed twice", async () => {
  await assert.rejects(
    () => expandLinkedRecords(
      { tableId: "table-lines", recordIds: ["r1", "r1"], text: "笔记本,笔记本" },
      reader(),
    ),
    { message: "关联字段包含重复记录 ID：r1" },
  );
});

test("SPEC-LINK-03: timeout semantics survive record-level context wrapping", async () => {
  const timeout = Object.assign(new Error("读取多维表格数据超时：读取关联记录"), {
    name: "BitableReadTimeoutError",
  });
  const timeoutReader: LinkedTableReader = {
    async getOrderedFields() { return [{ id: "f1", name: "产品" }]; },
    async getCellText() { throw timeout; },
  };
  await assert.rejects(
    () => expandLinkedRecords(
      { tableId: "table-lines", recordIds: ["r1"], text: "笔记本" },
      timeoutReader,
    ),
    (error: unknown) => error === timeout,
  );
});
