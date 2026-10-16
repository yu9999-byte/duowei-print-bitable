import assert from "node:assert/strict";
import test from "node:test";
import { renderAutomationArtifactInBrowser } from "../src/automation/renderer-browser.ts";
import { fieldDataSourceId } from "../src/core/data-sources.ts";

const pdf = new Blob([
  "%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n2 0 obj << /Type /Page >> endobj\n%%EOF",
], { type: "application/pdf" });

test("IT-AUTO-02/03: browser renderer resolves stable field ids and emits a complete PDF", async () => {
  const calls: unknown[] = [];
  const designer = {
    loadTemplateData(template: unknown) { calls.push(["load", template]); return true; },
    async setVariables(variables: unknown) { calls.push(["variables", variables]); },
    async export(request: unknown) { calls.push(["export", request]); return pdf; },
  };
  const result = await renderAutomationArtifactInBrowser(designer, {
    artifactKey: "duowei:v1:key",
    template: {
      id: "template-a",
      revision: "revision-a",
      snapshot: {
        canvasSize: { width: 600, height: 800 },
        pages: [{ elements: [{
          id: "summary",
          type: "text",
          content: `订单：@${fieldDataSourceId("field-a")}`,
          variable: `@${fieldDataSourceId("field-a")}`,
        }] }],
      },
    },
    values: { "field-a": "SO-001" },
    output: { type: "pdf", pageLimit: null },
  });
  assert.equal(result.artifactKey, "duowei:v1:key");
  assert.equal(result.contentType, "application/pdf");
  assert.equal(result.pageCount, 2);
  assert.match(result.fileName, /\.pdf$/);
  assert.equal(new TextDecoder().decode(result.bytes.slice(0, 5)), "%PDF-");
  assert.match(JSON.stringify(calls[0]), /@__duowei_render_summary/);
  assert.deepEqual((calls[1] as [string, Record<string, unknown>])[1][fieldDataSourceId("field-a")], "SO-001");
  assert.deepEqual(calls[2], ["export", { type: "pdfBlob" }]);
});

test("IT-AUTO-02/06: renderer rejects unsafe output semantics before loading a template", async () => {
  let loads = 0;
  const designer = {
    loadTemplateData() { loads += 1; return true; },
    async setVariables() {},
    async export() { return pdf; },
  };
  const input = {
    artifactKey: "duowei:v1:key",
    template: { id: "template-a", revision: "revision-a", snapshot: { pages: [] } },
    values: {},
  } as const;
  await assert.rejects(renderAutomationArtifactInBrowser(designer, {
    ...input, output: { type: "png", pageLimit: null },
  }), /第一页/);
  await assert.rejects(renderAutomationArtifactInBrowser(designer, {
    ...input, output: { type: "pdf", pageLimit: 1 },
  }), /完整多页/);
  assert.equal(loads, 0);
});
