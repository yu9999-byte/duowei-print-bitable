import assert from "node:assert/strict";
import test from "node:test";
import { ViewType } from "@lark-base-open/js-sdk";
import {
  getActiveSelection,
  getCurrentRecordIds,
  getInitialTableViewRecord,
  sameContext,
  selectRecordIds,
} from "../src/host/feishu-context.ts";

const tableSelection = { baseId: "base", tableId: "table", viewId: "widget", recordId: null };
function initialRecordTable(recordIds = ["sorted-first"]) {
  const calls: unknown[] = [];
  return {
    calls,
    async getViewMetaList() { return [
      { id: "widget", name: "打印", type: ViewType.WidgetView },
      { id: "form", name: "表单", type: ViewType.Form },
      { id: "grid", name: "订单", type: ViewType.Grid },
      { id: "filtered", name: "筛选订单", type: ViewType.Grid },
    ]; },
    async getRecordIdListByPage(params: unknown) {
      calls.push(params);
      return { recordIds, total: recordIds.length, hasMore: false };
    },
  };
}

test("table view initializes from the first source-view row without opening the picker", async () => {
  const table = initialRecordTable();
  const result = await getInitialTableViewRecord(tableSelection, "", async (id) => {
    assert.equal(id, "table");
    return table;
  });
  assert.deepEqual(result.views.map((v) => v.id), ["grid", "filtered"]);
  assert.equal(result.recordId, "sorted-first");
  assert.deepEqual(table.calls, [{ viewId: "grid", pageSize: 1 }]);
});

test("table view retains a valid preferred source view and its ordering", async () => {
  const table = initialRecordTable(["filtered-first"]);
  assert.equal((await getInitialTableViewRecord(tableSelection, "filtered", async () => table)).recordId, "filtered-first");
  assert.deepEqual(table.calls, [{ viewId: "filtered", pageSize: 1 }]);
});

test("an empty source view does not silently use a row outside its filter", async () => {
  const table = initialRecordTable([]);
  assert.equal((await getInitialTableViewRecord(tableSelection, "filtered", async () => table)).recordId, null);
  assert.equal(table.calls.length, 1);
});

test("no printable source view returns an empty state without querying the widget", async () => {
  const table = initialRecordTable();
  table.getViewMetaList = async () => [];
  const result = await getInitialTableViewRecord(tableSelection, "deleted", async () => table);
  assert.equal(result.recordId, null);
  assert.equal(result.sourceViewId, "");
  assert.deepEqual(table.calls, []);
});

test("automatic first-row reads time out instead of waiting for a selection", async () => {
  const table = initialRecordTable();
  table.getRecordIdListByPage = () => new Promise(() => {});
  await assert.rejects(() => getInitialTableViewRecord(tableSelection, "grid", async () => table, 10), /读取第一条记录/);
});

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

test("UT-BATCH-10: cancelling the record picker returns an empty candidate without fallback IDs", async () => {
  const ids = await selectRecordIds(
    { baseId: "base", tableId: "table", viewId: "view", recordId: "host-record" },
    async () => [],
  );
  assert.deepEqual(ids, []);
});
