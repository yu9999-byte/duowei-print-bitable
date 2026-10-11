import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { prepareTemplateCandidate } from "../src/core/template-candidate-transaction.ts";

test("CT-TPL-05: an explicit template is loaded and first-rendered before the caller can commit draft state", async () => {
  const calls: string[] = [];
  const template = { id: "explicit-default", pages: [{ elements: [] }] };

  const candidate = await prepareTemplateCandidate({
    template,
    load: async (value) => { calls.push(`load:${value.id}`); },
    render: async () => { calls.push("render"); return { pages: ["ready"] }; },
    restore: async () => { calls.push("restore"); },
  });
  calls.push("commit");

  assert.equal(candidate.template, template);
  assert.deepEqual(candidate.rendered, { pages: ["ready"] });
  assert.deepEqual(calls, ["load:explicit-default", "render", "commit"]);
});

test("CT-TPL-05: load failure restores the previous designer and never yields a draft candidate", async () => {
  const calls: string[] = [];
  await assert.rejects(() => prepareTemplateCandidate({
    template: { id: "default" },
    load: async () => { calls.push("load"); throw new Error("load failed"); },
    render: async () => { calls.push("render"); return "new"; },
    restore: async () => { calls.push("restore"); },
  }), /load failed/);
  assert.deepEqual(calls, ["load", "restore"]);
});

test("CT-TPL-05/CT-BATCH-06-UI: first-render failure restores the previous designer and printable batch", async () => {
  const calls: string[] = [];
  const previousRendered = { pages: ["old-1", "old-2", "old-3"] };
  let visibleRendered = previousRendered;

  await assert.rejects(() => prepareTemplateCandidate({
    template: { id: "labels" },
    load: async () => { calls.push("load"); },
    render: async () => { calls.push("render"); throw new Error("render failed"); },
    restore: async () => { calls.push("restore"); },
  }), /render failed/);

  assert.equal(visibleRendered, previousRendered);
  assert.deepEqual(calls, ["load", "render", "restore"]);
});

test("CT-TPL-05: restore failure keeps the original failure as the primary diagnostic", async () => {
  await assert.rejects(() => prepareTemplateCandidate({
    template: { id: "continuous" },
    load: async () => { throw new Error("bind failed"); },
    render: async () => "unused",
    restore: async () => { throw new Error("restore failed"); },
  }), (cause: unknown) => {
    assert.ok(cause instanceof AggregateError);
    assert.match(cause.message, /bind failed/);
    assert.match(cause.message, /restore failed/);
    return true;
  });
});

test("CT-TPL-06: App creates blank or automatic templates as explicit objects and exposes contextual retry", () => {
  const source = readFileSync("src/App.vue", "utf8");
  assert.match(source, /generateTemplate\(job\)/);
  assert.match(source, /generateBlankTemplate\(job\)/);
  assert.doesNotMatch(source, /createTemplate\('continuous'\)|createTemplate\('labels'\)|createTemplate\('default'\)/);
  assert.match(source, /templateCreateError/);
  assert.match(source, />重试创建<\/button>/);
});
