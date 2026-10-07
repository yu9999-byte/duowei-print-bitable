import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import type { PrintJob } from "../src/core/print-job.ts";

const job: PrintJob = {
  source: { baseId: "base", tableId: "orders", recordIds: ["rec-1", "rec-2"] },
  table: { name: "订单", fields: [
    { id: "order", name: "订单编号", type: "1", isPrimary: true },
    { id: "customer", name: "客户", type: "1" },
  ] },
  documents: [
    { recordId: "rec-1", values: { 订单编号: "PO-0001", 客户: "甲公司" } },
    { recordId: "rec-2", values: { 订单编号: "PO-0002", 客户: "乙公司" } },
  ],
  // 18:05 UTC is the next local day in Asia/Shanghai.
  generatedAt: "2026-10-03T18:05:03.000Z",
};

test("BUG-0008: all output preparation paths use one local print date", () => {
  const urls = {
    dataSources: new URL("../src/core/data-sources.ts", import.meta.url).href,
    templates: new URL("../src/core/template-generator.ts", import.meta.url).href,
    labels: new URL("../src/core/label-layout.ts", import.meta.url).href,
    continuous: new URL("../src/core/continuous-layout.ts", import.meta.url).href,
  };
  const script = `
    import assert from "node:assert/strict";
    import { readFileSync } from "node:fs";
    import { getDocumentVariables, prepareTemplateForOutput, SYSTEM_PRINT_DATE_ID } from ${JSON.stringify(urls.dataSources)};
    import { generateTemplate, generateLabelTemplate, generateContinuousTemplate } from ${JSON.stringify(urls.templates)};
    import { prepareLabelLayout } from ${JSON.stringify(urls.labels)};
    import { prepareContinuousLayout } from ${JSON.stringify(urls.continuous)};

    const job = JSON.parse(readFileSync(0, "utf8"));
    const expected = "2026-10-04";
    const values = job.documents.map((_, index) => getDocumentVariables(job, index));
    assert.deepEqual(values.map((item) => item[SYSTEM_PRINT_DATE_ID]), [expected, expected]);

    // Single and default batch output both use the ordinary prepared template path.
    const ordinary = generateTemplate(job);
    const ordinaryOutputs = values.map((item) => prepareTemplateForOutput(ordinary, item));
    assert.deepEqual(ordinaryOutputs.map((item) => item.variables[SYSTEM_PRINT_DATE_ID]), [expected, expected]);

    const label = prepareLabelLayout(generateLabelTemplate(job), job);
    assert.deepEqual(label.variables.labels.map((item) => item[SYSTEM_PRINT_DATE_ID]), [expected, expected]);

    const continuous = prepareContinuousLayout(generateContinuousTemplate(job), job);
    assert.deepEqual(continuous.variables.__duowei_continuous_rows
      .map((item) => item[SYSTEM_PRINT_DATE_ID]), [expected, expected]);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    input: JSON.stringify(job),
    env: { ...process.env, TZ: "Asia/Shanghai" },
    encoding: "utf8",
    timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
