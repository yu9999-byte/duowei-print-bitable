import assert from "node:assert/strict";
import test from "node:test";
import {
  createBatchEditProjection,
  reconcileBatchEditProjection,
} from "../src/core/batch-edit-projection.ts";
import { generateContinuousTemplate, generateLabelTemplate, generateTemplate } from "../src/core/template-generator.ts";
import type { PrintJob } from "../src/core/print-job.ts";

function job(count = 3): PrintJob {
  return {
    generatedAt: "2026-10-09T00:00:00.000Z",
    table: {
      id: "tbl-orders",
      name: "订单表",
      fields: [
        { id: "fld-order", name: "订单编号", type: 1, isPrimary: true },
        { id: "fld-customer", name: "客户", type: 1 },
      ],
    },
    documents: Array.from({ length: count }, (_, index) => ({
      recordId: `rec-${index + 1}`,
      values: {
        订单编号: `PO-000${index + 1}`,
        客户: ["甲公司", "乙公司", "丙公司"][index] ?? `客户${index + 1}`,
      },
    })),
  };
}

function textElements(template: Record<string, any>) {
  return template.pages.flatMap((page: any) => page.elements)
    .filter((element: any) => element.type === "text");
}

test("CT-BATCH-09-EDIT: default projection exposes every selected record as editable pages", () => {
  const source = generateTemplate(job());
  const projection = createBatchEditProjection(source, job(), "default");

  assert.equal(projection.template.pages.length, source.pages.length * 3);
  assert.deepEqual(projection.recordIds, ["rec-1", "rec-2", "rec-3"]);
  assert.deepEqual(new Set(Object.values(projection.elementRecordIndexes)), new Set([0, 1, 2]));

  const secondPage = projection.template.pages[source.pages.length] as any;
  const secondText = secondPage.elements.find((element: any) => element.type === "text" && /订单编号/.test(element.content));
  assert.equal(projection.elementValues[secondText.id]["__duowei_field_fld-order"], "PO-0002");
});

test("CT-BATCH-09-EDIT: editing any default instance becomes the one shared template", () => {
  const source = generateTemplate(job());
  const projection = createBatchEditProjection(source, job(), "default");
  const edited = structuredClone(projection.template) as any;
  const secondPage = edited.pages[source.pages.length];
  const title = secondPage.elements.find((element: any) => element.id.includes("auto-title"));
  title.content = "统一后的批量标题";

  const reconciled = reconcileBatchEditProjection(edited, projection);
  assert.equal(reconciled.changed, true);
  assert.equal(textElements(reconciled.template).some((element: any) => element.content === "统一后的批量标题"), true);
  assert.equal(JSON.stringify(reconciled.template).includes("__duoweiBatch"), false);

  const refreshed = createBatchEditProjection(reconciled.template, job(), "default");
  assert.equal(textElements(refreshed.template)
    .filter((element: any) => element.content === "统一后的批量标题").length, 3);
});

test("CT-BATCH-09-EDIT: continuous projection is one complete scrollable long canvas", () => {
  const source = generateContinuousTemplate(job());
  const projection = createBatchEditProjection(source, job(), "continuous");
  const sourceHeight = source.canvasSize.height;

  assert.equal(projection.template.pages.length, 1);
  assert.equal(projection.template.canvasSize.height, projection.recordHeight! * 3);
  assert.equal(projection.template.pages[0].elements.length, source.pages[0].elements.length * 3);

  const edited = structuredClone(projection.template) as any;
  const secondRecordTitle = edited.pages[0].elements.find((element: any) =>
    element.__duoweiBatchRecordIndex === 1 && element.id.includes("continuous-title"));
  secondRecordTitle.x += 18;
  const reconciled = reconcileBatchEditProjection(edited, projection);
  const sharedTitle = (reconciled.template.pages[0] as any).elements
    .find((element: any) => element.id === "continuous-title");
  assert.equal(reconciled.template.canvasSize.height, sourceHeight);
  assert.equal(sharedTitle.x, (source.pages[0].elements[0] as any).x + 18);
});

test("CT-BATCH-09-EDIT: label projection shows all records in the final grid and collapses any cell edit", () => {
  const source = generateLabelTemplate(job());
  const projection = createBatchEditProjection(source, job(), "labels");
  const records = (projection.template.pages as any[])
    .flatMap((page) => page.elements)
    .filter((element: any) => Number.isInteger(element.__duoweiBatchRecordIndex));

  assert.deepEqual(new Set(records.map((element: any) => element.__duoweiBatchRecordIndex)), new Set([0, 1, 2]));
  assert.equal(projection.template.pages.length, 1);

  const edited = structuredClone(projection.template) as any;
  const thirdLabel = edited.pages[0].elements.find((element: any) =>
    element.__duoweiBatchRecordIndex === 2 && element.id.includes("label-summary"));
  thirdLabel.style.fontSize = 22;
  const reconciled = reconcileBatchEditProjection(edited, projection);
  const sharedLabel = (reconciled.template.pages[0] as any).elements
    .find((element: any) => element.id === "label-summary");
  assert.equal(sharedLabel.style.fontSize, 22);
});

test("CT-BATCH-09-EDIT: divergent simultaneous instance edits are rejected instead of choosing silently", () => {
  const source = generateContinuousTemplate(job());
  const projection = createBatchEditProjection(source, job(), "continuous");
  const edited = structuredClone(projection.template) as any;
  const titles = edited.pages[0].elements.filter((element: any) => element.id.includes("continuous-title"));
  titles[0].content = "版本 A";
  titles[1].content = "版本 B";

  assert.throws(() => reconcileBatchEditProjection(edited, projection), /一次只编辑一个批量实例/);
});

test("CT-LINK-BATCH-01: default projection isolates linked rows and reconciles one shared template", () => {
  const linkedJob = job(2);
  linkedJob.table.fields.push({
    id: "fld-lines",
    name: "明细",
    type: "18",
    isLink: true,
    arrayColumns: [{ field: "明细编号", header: "明细编号" }],
  });
  linkedJob.documents[0].values.明细 = [{ 明细编号: "A-001" }, { 明细编号: "A-002" }];
  linkedJob.documents[1].values.明细 = [{ 明细编号: "B-001" }];
  const source = generateTemplate(linkedJob);
  const projection = createBatchEditProjection(source, linkedJob, "default");
  const tables = (projection.template.pages as any[])
    .flatMap((page) => page.elements)
    .filter((element: any) => element.type === "table");

  assert.equal(tables.length, 2);
  assert.deepEqual(projection.elementValues[tables[0].id].明细, [{ 明细编号: "A-001" }, { 明细编号: "A-002" }]);
  assert.deepEqual(projection.elementValues[tables[1].id].明细, [{ 明细编号: "B-001" }]);
  assert.notEqual(tables[0].variable, tables[1].variable);

  const reconciled = reconcileBatchEditProjection(projection.template, projection);
  assert.equal(reconciled.changed, false);
  assert.equal((reconciled.template.pages as any[]).flatMap((page) => page.elements)
    .filter((element: any) => element.type === "table").length, 1);
  const persisted = JSON.stringify(reconciled.template);
  assert.equal(persisted.includes("A-002"), false);
  assert.equal(persisted.includes("B-001"), false);
  assert.equal(persisted.includes("rec-1"), false);
  assert.equal(persisted.includes("rec-2"), false);
  assert.equal(JSON.stringify(reconciled.template).includes("__duowei_batch"), false);
});


test("compact continuous edit keeps A4 paper when saved and switched back to default", () => {
  const source = generateContinuousTemplate(job());
  source.canvasSize.height = 1123;
  const projection = createBatchEditProjection(source, job(), "continuous");
  assert.ok(projection.recordHeight! < 1123);
  assert.equal(reconcileBatchEditProjection(projection.template, projection).changed, false);
  const edited = structuredClone(projection.template) as any;
  const title = edited.pages[0].elements.find((e: any) => e.__duoweiBatchRecordIndex === 1);
  title.x += 5;
  const saved = reconcileBatchEditProjection(edited, projection).template;
  assert.equal(saved.canvasSize.height, 1123);
  const defaults = createBatchEditProjection(saved, job(), "default");
  assert.equal(defaults.template.pages.length, 3);
  assert.equal(defaults.template.canvasSize.height, 1123);
});
