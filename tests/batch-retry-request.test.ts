import assert from "node:assert/strict";
import test from "node:test";
import {
  createBatchRetryRequest,
  isBatchRetryRequestCurrent,
} from "../src/core/batch-retry-request.ts";

const context = {
  baseId: "base-a",
  tableId: "table-a",
  viewId: "view-a",
  recordId: "host-a",
};

test("UT-BATCH-13: retry request freezes context, template, and ordered record IDs", () => {
  const selected = ["record-3", "record-1", "record-2"];
  const request = createBatchRetryRequest(context, "template-a", selected);
  selected.reverse();

  assert.deepEqual(request.recordIds, ["record-3", "record-1", "record-2"]);
  assert.equal(Object.isFrozen(request), true);
  assert.equal(Object.isFrozen(request.context), true);
  assert.equal(Object.isFrozen(request.recordIds), true);
});

test("UT-BATCH-13: context or template changes invalidate the retry request", () => {
  const request = createBatchRetryRequest(context, "template-a", ["record-1"]);
  assert.equal(isBatchRetryRequestCurrent(request, context, "template-a"), true);
  assert.equal(isBatchRetryRequestCurrent(request, { ...context, recordId: "host-b" }, "template-a"), false);
  assert.equal(isBatchRetryRequestCurrent(request, context, "template-b"), false);
});
