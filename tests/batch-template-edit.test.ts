import assert from "node:assert/strict";
import test from "node:test";
import { commitBatchTemplateEdit } from "../src/core/batch-template-edit.ts";

test("IT-BATCH-EDIT-01: persistence precedes rendering and success returns one atomic replacement", async () => {
  const calls: string[] = [];
  const result = await commitBatchTemplateEdit({
    previousRendered: { pages: ["old"] },
    persist: async () => { calls.push("persist"); return { revision: "v2" }; },
    render: async () => { calls.push("render"); return { pages: ["new"] }; },
  });

  assert.deepEqual(calls, ["persist", "render"]);
  assert.deepEqual(result, {
    ok: true,
    saved: { revision: "v2" },
    rendered: { pages: ["new"] },
  });
});

test("IT-BATCH-EDIT-01: render failure keeps the saved template and exact previous printable batch", async () => {
  const previous = { pages: ["old-1", "old-2"] };
  const result = await commitBatchTemplateEdit({
    previousRendered: previous,
    persist: async () => ({ revision: "v2" }),
    render: async () => { throw new Error("render failed"); },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.saved, { revision: "v2" });
  assert.equal(result.rendered, previous);
  assert.match(result.error.message, /render failed/);
});

test("IT-BATCH-EDIT-01: persistence failure never starts rendering", async () => {
  let renders = 0;
  await assert.rejects(() => commitBatchTemplateEdit({
    previousRendered: { pages: ["old"] },
    persist: async () => { throw new Error("save failed"); },
    render: async () => { renders += 1; return { pages: ["new"] }; },
  }), /save failed/);
  assert.equal(renders, 0);
});
