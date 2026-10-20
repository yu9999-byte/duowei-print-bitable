import assert from "node:assert/strict";
import test from "node:test";
import { rememberTableViewRecord, resolveTableViewRecord, tableViewRecord } from "../src/host/plugin-host.ts";

const context = { baseId: "base", tableId: "table", viewId: "widget" };

test("automatic table records follow the latest first row and clear when the source becomes empty", () => {
  assert.equal(resolveTableViewRecord(context, { sourceViewId: "grid", recordId: "r1" }), "r1");
  assert.equal(resolveTableViewRecord(context, { sourceViewId: "grid", recordId: "r2" }), "r2");
  assert.equal(tableViewRecord(context), "r2");
  assert.equal(resolveTableViewRecord(context, { sourceViewId: "grid", recordId: null }), null);
  assert.equal(tableViewRecord(context), null);
});

test("explicit table selection survives retry only in the same host and source view", () => {
  rememberTableViewRecord(context, "picked", { sourceViewId: "grid", explicit: true });
  assert.equal(resolveTableViewRecord(context, { sourceViewId: "grid", recordId: "new-first" }), "picked");
  assert.equal(resolveTableViewRecord(context, { sourceViewId: "filtered", recordId: "filtered-first" }), "filtered-first");
  rememberTableViewRecord(context, "picked", { sourceViewId: "grid", explicit: true });
  assert.equal(resolveTableViewRecord({ ...context, tableId: "other" }, { sourceViewId: "grid", recordId: "other-first" }), "other-first");
  assert.equal(tableViewRecord(context), null);
});
