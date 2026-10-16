import assert from "node:assert/strict";
import test from "node:test";
import { fitDesignerZoom, fitPreviewPaper } from "../src/components/preview-fit.ts";

test("a full A4 preview fits inside the narrow Feishu record panel", () => {
  assert.equal(fitPreviewPaper(794, 440.8), 440.8 / 794);
});

test("the preview keeps its real paper size when the workspace is wide enough", () => {
  assert.equal(fitPreviewPaper(794, 1000), 1);
});

test("the preview does not create invalid scaling before its viewport is measured", () => {
  assert.equal(fitPreviewPaper(794, 0), 1);
  assert.equal(fitPreviewPaper(0, 440), 1);
});

test("editing starts with the complete A4 width visible in a narrow record panel", () => {
  assert.equal(fitDesignerZoom(794, 479, 1), 0.45);
  assert.ok(794 * fitDesignerZoom(794, 479, 1) + 93 <= 479);
});

test("editing preserves an existing smaller zoom and never enlarges the paper", () => {
  assert.equal(fitDesignerZoom(794, 479, 0.4), 0.4);
  assert.equal(fitDesignerZoom(794, 1000, 0.8), 0.8);
});

test("editing keeps a usable minimum zoom when the host is exceptionally narrow", () => {
  assert.equal(fitDesignerZoom(794, 220, 1), 0.2);
  assert.equal(fitDesignerZoom(794, 0, 1), 1);
});
