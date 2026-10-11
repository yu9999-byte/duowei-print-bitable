import assert from "node:assert/strict";
import test from "node:test";
import { commitBatchLayoutChange } from "../src/core/batch-layout-transaction.ts";

test("UT-BATCH-LAYOUT-03: candidate renders before persistence and commits once", async () => {
  const calls: string[] = [];
  const result = await commitBatchLayoutChange({
    applyCandidate: async () => { calls.push("apply"); },
    renderCandidate: async () => { calls.push("render"); return "new-preview"; },
    prepareEditableProjection: async () => { calls.push("project-all-records"); },
    persistCandidate: async () => { calls.push("persist"); return "saved-template"; },
    restoreCommitted: async () => { calls.push("restore"); },
  });

  assert.deepEqual(calls, ["apply", "render", "project-all-records", "persist"]);
  assert.deepEqual(result, { rendered: "new-preview", saved: "saved-template" });
});

test("UT-BATCH-LAYOUT-03: render failure restores the committed canvas and never saves", async () => {
  const calls: string[] = [];
  await assert.rejects(() => commitBatchLayoutChange({
    applyCandidate: async () => { calls.push("apply"); },
    renderCandidate: async () => { calls.push("render"); throw new Error("render failed"); },
    prepareEditableProjection: async () => { calls.push("project-all-records"); },
    persistCandidate: async () => { calls.push("persist"); return "saved-template"; },
    restoreCommitted: async () => { calls.push("restore"); },
  }), /render failed/);

  assert.deepEqual(calls, ["apply", "render", "restore"]);
});

test("UT-BATCH-LAYOUT-03: persistence failure restores the old full-batch edit projection", async () => {
  const calls: string[] = [];
  await assert.rejects(() => commitBatchLayoutChange({
    applyCandidate: async () => { calls.push("apply"); },
    renderCandidate: async () => { calls.push("render"); return "candidate-preview"; },
    prepareEditableProjection: async () => { calls.push("project-all-records"); },
    persistCandidate: async () => { calls.push("persist"); throw new Error("save failed"); },
    restoreCommitted: async () => { calls.push("restore-old-projection"); },
  }), /save failed/);

  assert.deepEqual(calls, ["apply", "render", "project-all-records", "persist", "restore-old-projection"]);
});
