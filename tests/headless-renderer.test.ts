import assert from "node:assert/strict";
import test from "node:test";
import {
  createHeadlessBrowserRenderer,
  installAutomationRenderPageHost,
  type AutomationRenderPageApi,
} from "../src/automation/headless-renderer.ts";
import type { AutomationRenderRequest } from "../src/automation/automation-domain.ts";

const pdf = new Blob([
  "%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%%EOF",
], { type: "application/pdf" });

function request(): AutomationRenderRequest {
  return {
    artifactKey: "duowei:v1:artifact-a",
    template: {
      id: "template-a",
      revision: "revision-a",
      snapshot: { canvasSize: { width: 600, height: 800 }, pages: [] },
    },
    values: {},
    output: { type: "pdf", pageLimit: null },
  };
}

test("IT-AUTO-02: browser page host executes the locked designer renderer and serializes bytes", async () => {
  const target: { __DUOWEI_AUTOMATION_RENDERER__?: AutomationRenderPageApi } = {};
  installAutomationRenderPageHost({
    loadTemplateData() { return true; },
    async setVariables() {},
    async export() { return pdf; },
  }, target);
  const result = await target.__DUOWEI_AUTOMATION_RENDERER__!.render(request());
  assert.equal(result.protocolVersion, 1);
  assert.equal(result.artifactKey, "duowei:v1:artifact-a");
  assert.equal(result.contentType, "application/pdf");
  assert.deepEqual(result.bytes.slice(0, 5), [37, 80, 68, 70, 45]);
});

test("IT-AUTO-02/08: headless adapter opens one isolated page and always closes it", async () => {
  let opens = 0;
  let closes = 0;
  const renderer = createHeadlessBrowserRenderer({
    async openPage() {
      opens += 1;
      return {
        async render(input) {
          return {
            protocolVersion: 1,
            artifactKey: input.artifactKey,
            fileName: "发货单.pdf",
            contentType: "application/pdf",
            pageCount: 1,
            bytes: [...new Uint8Array(await pdf.arrayBuffer())],
          };
        },
        async close() { closes += 1; },
      };
    },
  });
  const result = await renderer.render(request());
  assert.equal(opens, 1);
  assert.equal(closes, 1);
  assert.equal(result.bytes instanceof Uint8Array, true);

  const failing = createHeadlessBrowserRenderer({
    async openPage() {
      return {
        async render() { throw new Error("page crashed"); },
        async close() { closes += 1; },
      };
    },
  });
  await assert.rejects(failing.render(request()), /page crashed/);
  assert.equal(closes, 2);
});

test("SPEC-AUTO-08: headless adapter rejects a mismatched page protocol", async () => {
  const renderer = createHeadlessBrowserRenderer({
    async openPage() {
      return {
        async render(input) {
          return {
            protocolVersion: 2 as 1,
            artifactKey: input.artifactKey,
            fileName: "发货单.pdf",
            contentType: "application/pdf",
            pageCount: 1,
            bytes: [37, 80, 68, 70, 45],
          };
        },
        async close() {},
      };
    },
  });
  await assert.rejects(renderer.render(request()), /协议版本/);
});

test("SPEC-AUTO-08: aborting a headless render closes its isolated page", async () => {
  let closes = 0;
  let rejectRender: ((error: Error) => void) | undefined;
  const renderer = createHeadlessBrowserRenderer({
    async openPage() {
      return {
        render() {
          return new Promise((_resolve, reject) => { rejectRender = reject; });
        },
        async close() {
          closes += 1;
          rejectRender?.(new Error("page closed"));
        },
      };
    },
  });
  const controller = new AbortController();
  const pending = renderer.render(request(), controller.signal);
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, /page closed|渲染已取消/);
  assert.ok(closes >= 1);
});
