import assert from "node:assert/strict";
import test from "node:test";
import { prepareContinuousLayout } from "../src/core/continuous-layout.ts";
import { fieldDataSourceId } from "../src/core/data-sources.ts";
import type { PrintJob } from "../src/core/print-job.ts";

const orderToken = `@${fieldDataSourceId("order")}`;
const customerToken = `@${fieldDataSourceId("customer")}`;

function job(count = 7): PrintJob {
  return {
    source: {
      baseId: "base",
      tableId: "table",
      recordIds: Array.from({ length: count }, (_, index) => `rec-${index + 1}`),
    },
    table: {
      name: "订单",
      fields: [
        { id: "order", name: "订单编号", type: "1", isPrimary: true },
        { id: "customer", name: "客户", type: "1" },
      ],
    },
    documents: Array.from({ length: count }, (_, index) => ({
      recordId: `rec-${index + 1}`,
      values: { 订单编号: `PO-${index + 1}`, 客户: `客户${index + 1}` },
    })),
    generatedAt: "2026-09-30T10:00:00.000Z",
  };
}

function template() {
  return {
    canvasSize: { width: 600, height: 400 },
    pages: [{ id: "page", elements: [
      {
        id: "summary",
        type: "text",
        x: 24,
        y: 28,
        width: 552,
        height: 60,
        content: `订单：${orderToken}，客户：${customerToken}`,
        variable: orderToken,
      },
      { id: "divider", type: "line", x: 24, y: 112, width: 552, height: 1 },
    ] }],
  };
}

test("SPEC-CONT-02: ordered records become one native vertical continuous sheet", () => {
  const source = template();
  const output = prepareContinuousLayout(source, job());

  assert.equal(output.pageCount, 1);
  assert.equal(output.canvasWidth, 600);
  assert.equal(output.canvasHeight, 903);
  assert.deepEqual(output.recordIds, job().source.recordIds);
  assert.deepEqual(output.template.canvasSize, { width: 600, height: 903 });
  const elements = (output.template.pages as any)[0].elements;
  assert.equal(elements[0].type, "multiLabel");
  assert.deepEqual({ rows: elements[0].rows, cols: elements[0].cols,
    width: elements[0].width, height: elements[0].height,
    gapX: elements[0].gapX, gapY: elements[0].gapY }, {
    rows: 7, cols: 1, width: 600, height: 129, gapX: 0, gapY: 0,
  });
  assert.equal(elements[1].content, "@__duowei_render_summary");
  assert.deepEqual(output.variables.__duowei_continuous_rows.map((row: any) => row.__duowei_render_summary),
    Array.from({ length: 7 }, (_, index) => `订单：PO-${index + 1}，客户：客户${index + 1}`));
  assert.deepEqual(source, template());
});

test("SPEC-SRC-08/CONT: deleted fields stay explicit in every continuous record segment", () => {
  const deletedToken = `@${fieldDataSourceId("deleted")}`;
  const source = template();
  source.pages[0].elements[0].content = `旧值：${deletedToken}`;
  source.pages[0].elements[0].variable = deletedToken;
  (source as any).ext = { fieldBindings: { deleted: "已删除字段" } };

  const output = prepareContinuousLayout(source, job(2));

  assert.deepEqual(output.variables.__duowei_continuous_rows.map((row: any) =>
    row.__duowei_render_summary), [
    "旧值：[字段已失效：已删除字段]",
    "旧值：[字段已失效：已删除字段]",
  ]);
  assert.ok(!JSON.stringify(output).includes("@__duowei_field_deleted"));
});

test("SPEC-CONT-03: continuous layout rejects structures whose height cannot be proven", () => {
  const multiPage = template();
  multiPage.pages.push({ id: "page-2", elements: [] });
  assert.throws(() => prepareContinuousLayout(multiPage, job(2)), /单页模板/);

  const table = template();
  table.pages[0].elements.push({ id: "table", type: "table", x: 24, y: 150, width: 552, height: 120 } as any);
  assert.throws(() => prepareContinuousLayout(table, job(2)), /表格/);

  const label = template();
  label.pages[0].elements.push({ id: "labels", type: "multiLabel", x: 0, y: 0,
    width: 100, height: 100 } as any);
  assert.throws(() => prepareContinuousLayout(label, job(2)), /标签模板/);

  const dynamic = template();
  (dynamic.pages[0].elements[0] as any).style = { autoHeight: true };
  assert.throws(() => prepareContinuousLayout(dynamic, job(2)), /动态高度/);

  const outside = template();
  outside.pages[0].elements[0].y = 370;
  assert.throws(() => prepareContinuousLayout(outside, job(2)), /纸张范围/);
});


test("continuous compacts A4 whitespace, preserves footer positions and original paper", () => {
  for (const count of [2, 3, 10, 50]) {
    const source = template();
    const result = prepareContinuousLayout(source, job(count));
    assert.equal(result.recordHeight, 129);
    assert.equal(result.canvasHeight, 129 * count);
    assert.deepEqual(source.canvasSize, { width: 600, height: 400 });
  }
  const source = template();
  source.pages[0].elements.push({ id: "footer", type: "text", x: 24, y: 360,
    width: 100, height: 30, content: "footer" } as any);
  assert.equal(prepareContinuousLayout(source, job(2)).recordHeight, 400);
});
