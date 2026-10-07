import assert from "node:assert/strict";
import test from "node:test";
import { createSSRApp } from "vue";
import { renderToString } from "@vue/server-renderer";
import { BatchStatus } from "../src/components/batch-status.ts";

test("CT-BATCH-05: batch status shows count, default layout and at most five summaries", async () => {
  const summaries = Array.from({ length: 7 }, (_, index) => ({
    recordId: `rec-${index + 1}`,
    label: `PO-000${index + 1}`,
  }));
  const html = await renderToString(createSSRApp(BatchStatus, { summaries }));

  assert.match(html, /已选 7 条/);
  assert.match(html, /默认排版/);
  for (const summary of summaries.slice(0, 5)) assert.ok(html.includes(summary.label));
  for (const summary of summaries.slice(5)) assert.ok(!html.includes(summary.label));
  assert.match(html, /等 2 条/);
});

test("CT-BATCH-05: a single-record batch has no misleading remainder", async () => {
  const html = await renderToString(createSSRApp(BatchStatus, {
    summaries: [{ recordId: "rec-1", label: "PO-0001" }],
  }));
  assert.match(html, /已选 1 条/);
  assert.match(html, /PO-0001/);
  assert.ok(!html.includes("等 0 条"));
});

test("CT-CONT-02-UI: batch status names continuous layout", async () => {
  const html = await renderToString(createSSRApp(BatchStatus, {
    summaries: [{ recordId: "rec-1", label: "PO-0001" }],
    layout: "continuous",
  }));
  assert.match(html, /连续排版/);
});
