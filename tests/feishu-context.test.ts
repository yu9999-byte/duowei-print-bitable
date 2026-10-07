import assert from "node:assert/strict";
import test from "node:test";
import {
  getActiveSelection,
  getCurrentRecordIds,
  sameContext,
  selectRecordIds,
} from "../src/host/feishu-context.ts";

test("SPEC-CTX-01: a table/view switch invalidates the old print context", () => {
  const current = { baseId: "base-1", tableId: "table-1", viewId: "view-1", recordId: "record-1" };
  assert.equal(sameContext(current, { ...current }), true);
  assert.equal(sameContext(current, { ...current, tableId: "table-2" }), false);
  assert.equal(sameContext(current, { ...current, viewId: "view-2" }), false);
  assert.equal(sameContext(current, { ...current, baseId: "base-2" }), false);
  assert.equal(sameContext(current, { ...current, recordId: "record-2" }), false);
});

test("SPEC-CTX-01: record view uses the host record without opening a picker", () => {
  assert.deepEqual(getCurrentRecordIds({
    baseId: "base-1",
    tableId: "table-1",
    viewId: "view-1",
    recordId: "record-1",
  }), ["record-1"]);
});

test("SPEC-CTX-02: missing host record never falls back to an arbitrary row", () => {
  assert.deepEqual(getCurrentRecordIds({
    baseId: "base-1",
    tableId: "table-1",
    viewId: "view-1",
    recordId: null,
  }), []);
});

test("UT-BATCH-08: a hanging host selection fails within the configured timeout", async () => {
  await assert.rejects(
    () => getActiveSelection(10, () => new Promise<never>(() => undefined)),
    { message: /读取多维表格数据超时：获取当前多维表格选择/ },
  );
});

test("UT-BATCH-10: the record picker is not constrained by SDK read timeout", async () => {
  const ids = await selectRecordIds(
    { baseId: "base", tableId: "table", viewId: "view", recordId: "record" },
    () => new Promise<string[]>((resolve) => {
      setTimeout(() => resolve(["record-2", "record-1", "record-2"]), 25);
    }),
  );
  assert.deepEqual(ids, ["record-2", "record-1"]);
});
