import assert from "node:assert/strict";
import test from "node:test";
import { prepareLabelLayout } from "../src/core/label-layout.ts";
import { generateLabelTemplate } from "../src/core/template-generator.ts";
import { fieldDataSourceId } from "../src/core/data-sources.ts";
import type { PrintJob } from "../src/core/print-job.ts";

const token = `@${fieldDataSourceId("order")}`;
const customerToken = `@${fieldDataSourceId("customer")}`;
const job: PrintJob = {
  source: { baseId: "base", tableId: "table", recordIds: Array.from({ length: 7 }, (_, i) => `rec-${i + 1}`) },
  table: { name: "订单", fields: [
    { id: "order", name: "订单编号", type: "1" },
    { id: "customer", name: "客户", type: "1" },
  ] },
  documents: Array.from({ length: 7 }, (_, i) => ({
    recordId: `rec-${i + 1}`,
    values: { 订单编号: `PO-${i + 1}`, 客户: `客户${i + 1}` },
  })),
  generatedAt: "2026-09-30T10:00:00.000Z",
};

function template() {
  return {
    canvasSize: { width: 600, height: 400 },
    pages: [{ id: "page", elements: [
      { id: "grid", type: "multiLabel", x: 20, y: 20, width: 170, height: 100,
        rows: 2, cols: 3, gapX: 20, gapY: 20, direction: "row", dataVariable: "@labels" },
      { id: "summary", type: "text", x: 30, y: 35, width: 150, height: 40,
        content: `订单：${token}，客户：${customerToken}`, variable: token },
    ] }],
  };
}

test("SPEC-LABEL-01/02: seven ordered records fill a native 2x3 grid with combined fields", () => {
  const source = template();
  const output = prepareLabelLayout(source, job);
  assert.equal(output.capacity, 6);
  assert.equal(output.pageCount, 2);
  assert.deepEqual(output.recordIds, job.source.recordIds);
  assert.deepEqual(output.variables.labels.map((row: any) => row.__duowei_render_summary),
    job.documents.map((_, i) => `订单：PO-${i + 1}，客户：客户${i + 1}`));
  assert.equal((output.template.pages as any)[0].elements[1].content, "@__duowei_render_summary");
  assert.deepEqual(source, template());
});

test("SPEC-SRC-08/LABEL: deleted fields stay explicit in every label item", () => {
  const deletedToken = `@${fieldDataSourceId("deleted")}`;
  const source = template();
  source.pages[0].elements[1].content = `旧值：${deletedToken}`;
  source.pages[0].elements[1].variable = deletedToken;
  (source as any).ext = { fieldBindings: { deleted: "已删除字段" } };

  const output = prepareLabelLayout(source, job);

  assert.deepEqual(output.variables.labels.map((row: any) => row.__duowei_render_summary),
    job.documents.map(() => "旧值：[字段已失效：已删除字段]"));
  assert.ok(!JSON.stringify(output).includes("@__duowei_field_deleted"));
});

test("SPEC-LABEL-01: a new label template is an editable native grid bound to actual fields", () => {
  const created = generateLabelTemplate(job);
  assert.equal((created.pages[0].elements[0] as any).type, "multiLabel");
  assert.equal((created.pages[0].elements[0] as any).rows, 3);
  assert.equal((created.pages[0].elements[0] as any).cols, 2);
  const output = prepareLabelLayout(created, job);
  assert.equal(output.pageCount, 2);
  assert.match(String((created.pages[0].elements[1] as any).content), /@__duowei_field_order/);
});

test("SPEC-LABEL-01: grid direction and final paper dimensions remain in the engine template", () => {
  const source = template();
  source.pages[0].elements[0].direction = "column";
  const output = prepareLabelLayout(source, job);
  assert.equal((output.template.pages as any)[0].elements[0].direction, "column");
  assert.deepEqual(output.template.canvasSize, { width: 600, height: 400 });
});

test("SPEC-LABEL-03: invalid grids cannot silently crop or repeat records", () => {
  const bad = template();
  bad.pages[0].elements[0].cols = 4;
  assert.throws(() => prepareLabelLayout(bad, job), /超出纸张/);
  const missing = template();
  missing.pages[0].elements.pop();
  assert.throws(() => prepareLabelLayout(missing, job), /首格/);
  const overflowing = template();
  overflowing.pages[0].elements[1].x = 100;
  assert.throws(() => prepareLabelLayout(overflowing, job), /首格/);
  const table = template();
  table.pages[0].elements[1].type = "table";
  assert.throws(() => prepareLabelLayout(table, job), /表格/);
  const decor = template();
  decor.pages[0].elements.push({ id: "decor", type: "text", x: 520, y: 20,
    width: 60, height: 20, content: token, variable: token } as any);
  assert.throws(() => prepareLabelLayout(decor, job), /页外动态元素/);
});
