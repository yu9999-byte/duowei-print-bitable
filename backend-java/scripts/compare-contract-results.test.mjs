import assert from "node:assert/strict";
import test from "node:test";
import { compareResults } from "./compare-contract-results.mjs";
const record = (body, traceHeader) => ({ id: "case-1", status: 200, body, traceHeader });
test("only random trace values differ while correlation is preserved", () => {
  assert.equal(compareResults([record({ traceId: "a", taskKey: "same" }, "a")], [record({ taskKey: "same", traceId: "b" }, "b")]).passed, true);
});
test("business changes, missing cases and extra cases fail", () => {
  assert.equal(compareResults([record({ taskKey: "a" })], [record({ taskKey: "b" })]).passed, false);
  assert.equal(compareResults([record({})], [{ ...record({}), id: "other" }]).failures.length, 2);
});
test("empty, duplicate and invalid trace evidence are rejected", () => {
  assert.throws(() => compareResults([], []));
  assert.throws(() => compareResults([record({}), record({})], [record({})]));
  assert.throws(() => compareResults([record({ traceId: "a" }, "wrong")], [record({})]));
});
