import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { generateContinuousTemplate, generateTemplate } from "../src/core/template-generator.ts";
import { hasContinuousLayout, prepareContinuousLayout } from "../src/core/continuous-layout.ts";
import { fieldDataSourceId } from "../src/core/data-sources.ts";

const job = {
  table: {
    name: "订单",
    fields: [
      { id: "customer", name: "客户", type: "text" },
      { id: "note", name: "备注", type: "text", isLongText: true },
      {
        id: "lines",
        name: "明细",
        type: "link",
        isLink: true,
        arrayColumns: [
          { field: "product", header: "产品", width: 180 },
          { field: "qty", header: "数量", width: 80 },
        ],
      },
    ],
  },
  documents: [
    {
      recordId: "rec-1",
      values: { 客户: "甲", 备注: "一段说明", 明细: [{ product: "纸", qty: 2 }] },
    },
  ],
} as const;

test("SPEC-PERF-01: pure single-record template generation stays below one second", (context) => {
  const fields = [
    ["order", "订单编号", true],
    ["customer", "客户名称", false],
    ["product", "商品名称", false],
    ["quantity", "数量", false],
    ["price", "单价", false],
    ["status", "订单状态", false],
    ["orderedAt", "下单日期", false],
    ["deliveryAt", "要求送达日期", false],
    ["address", "收货地址", false],
    ["phone", "联系电话", false],
    ["note", "备注", false],
  ].map(([id, name, isPrimary]) => ({ id: String(id), name: String(name), type: "1", isPrimary: Boolean(isPrimary) }));
  const values = {
    订单编号: "PO-0008",
    客户名称: "南京博远建筑材料有限公司",
    商品名称: "密封胶条",
    数量: 200,
    单价: "¥12.00",
    订单状态: "待出库",
    下单日期: "2026-09-21",
    要求送达日期: "2026-09-30",
    收货地址: "南京市雨花台区软件大道20号",
    联系电话: "13200132008",
    备注: "待出库，等待质检报告",
  };
  const startedAt = performance.now();
  const template = generateTemplate({
    table: { name: "仓库订单表", fields },
    documents: [{ recordId: "rec-perf-1", values }],
  });
  const elapsedMs = performance.now() - startedAt;

  context.diagnostic(`pure template generation: ${elapsedMs.toFixed(3)} ms; fields=11; records=1; node=${process.version}`);
  assert.ok(template.pages.length > 0);
  assert.ok(elapsedMs <= 1_000, `pure template generation took ${elapsedMs.toFixed(3)} ms`);
});

test("SPEC-TPL-01: generated template uses engine page schema and required sections", () => {
  const template = generateTemplate(job);
  assert.equal(template.pages.length, 1);
  assert.deepEqual(template.canvasSize, { width: 794, height: 1123 });
  const types = template.pages[0].elements.map((element) => element.type);
  assert.deepEqual(types, ["text", "line", "text", "text", "text", "text", "table", "text"]);
});

test("SPEC-CONT-02: generated continuous template is fixed-height and native-layout ready", () => {
  const template = generateContinuousTemplate(job);
  assert.equal(hasContinuousLayout(template), true);
  assert.equal(template.pages.length, 1);
  assert.ok(template.canvasSize.height < 1123);
  assert.ok(template.pages[0].elements.every((element) => element.type !== "table"));
  assert.ok(template.pages[0].elements.every((element) => element.style.autoHeight !== true));
  const output = prepareContinuousLayout(template, {
    ...job,
    source: { baseId: "base", tableId: "table", recordIds: ["rec-1"] },
    generatedAt: "2026-09-30T10:00:00.000Z",
  });
  assert.equal(output.pageCount, 1);
});

test("SPEC-TPL-03: short and long fields use distinct layout rows", () => {
  const elements = generateTemplate(job).pages[0].elements;
  const customer = elements.find((element) => element.id === "auto-field-1");
  const note = elements.find((element) => element.id === "auto-long-note");
  assert.equal(customer?.content, `客户：@${fieldDataSourceId("customer")}`);
  assert.equal(note?.content, `备注：@${fieldDataSourceId("note")}`);
  assert.ok((note?.width ?? 0) > (customer?.width ?? 0));
  assert.ok((note?.y ?? 0) > (customer?.y ?? 0));
});

test("SPEC-TPL-03: a text type is not automatically a long-text field", () => {
  const template = generateTemplate({
    table: { name: "客户", fields: [{ id: "name", name: "名称", type: "1" }] },
    documents: [{ recordId: "rec-1", values: { 名称: "短名称" } }],
  });
  assert.ok(template.pages[0].elements.some((element) => element.id === "auto-field-1"));
  assert.ok(!template.pages[0].elements.some((element) => element.id === "auto-long-name"));
});

test("SPEC-TPL-03: preview newlines classify text as long when no explicit setting exists", () => {
  const template = generateTemplate({
    table: { name: "客户", fields: [{ id: "memo", name: "说明", type: "1" }] },
    documents: [{ recordId: "rec-1", values: { 说明: "第一行\n第二行" } }],
  });
  assert.ok(template.pages[0].elements.some((element) => element.id === "auto-long-memo"));
});

test("SPEC-BATCH-03: later batch records with long text influence the shared template", () => {
  const template = generateTemplate({
    table: { name: "订单", fields: [{ id: "memo", name: "说明", type: "1" }] },
    documents: [
      { recordId: "rec-short", values: { 说明: "短" } },
      { recordId: "rec-long", values: { 说明: "第二条记录很长".repeat(20) } },
    ],
  });
  const memo = template.pages[0].elements.find((element) => element.id === "auto-long-memo");
  assert.equal(memo?.style.autoHeight, true);
});

test("SPEC-LINK-01: link field table binds the array variable and columns", () => {
  const table = generateTemplate(job).pages[0].elements.find((element) => element.type === "table");
  assert.equal(table?.variable, `@${fieldDataSourceId("lines")}`);
  assert.deepEqual(table?.columns, [
    { field: "product", header: "产品", width: 180 },
    { field: "qty", header: "数量", width: 80 },
  ]);
  assert.deepEqual(table?.data, [{ product: "纸", qty: 2 }]);
});

test("SPEC-LINK-03: an empty linked table has a separate variable-driven empty state", () => {
  const template = generateTemplate(job);
  const emptyState = template.pages[0].elements.find((element) => element.id === "auto-link-empty-lines");
  assert.equal(emptyState?.variable, "@__duowei_print_empty_lines");
  const fieldSources = template.ext.availableVariables.find((group) => group.label === "字段");
  assert.deepEqual(fieldSources?.children.find((source) => source.id === fieldDataSourceId("lines")), {
    id: fieldDataSourceId("lines"),
    label: "明细",
    isArray: true,
  });
  assert.ok(!template.ext.availableVariables
    .flatMap((group) => group.children)
    .some((source) => source.id === "__duowei_print_empty_lines"));
});

test("SPEC-TPL-04: many fields are split into bounded template pages", () => {
  const fields = Array.from({ length: 46 }, (_, index) => ({
    id: `field-${index + 1}`,
    name: `字段${index + 1}`,
    type: "1",
  }));
  const values = Object.fromEntries(fields.map((field) => [field.name, `值-${field.id}`]));
  const template = generateTemplate({
    table: { name: "超长订单", fields },
    documents: [{ recordId: "rec-many", values }],
  });

  assert.ok(template.pages.length > 1);
  const generatedFields = template.pages
    .flatMap((page) => page.elements)
    .filter((element) => element.id.startsWith("auto-field-"));
  assert.equal(generatedFields.length, fields.length);
  for (const page of template.pages) {
    for (const element of page.elements) {
      assert.ok(element.y >= 0, `${element.id} starts above its page`);
      assert.ok(element.y + element.height <= template.canvasSize.height, `${element.id} overflows its page`);
    }
  }
});

test("SPEC-TPL-04: long text opts into the engine auto-height flow", () => {
  const template = generateTemplate({
    table: { name: "说明单", fields: [{ id: "memo", name: "说明", type: "1", isLongText: true }] },
    documents: [{ recordId: "rec-1", values: { 说明: "很长的正文".repeat(200) } }],
  });
  const memo = template.pages[0].elements.find((element) => element.id === "auto-long-memo");
  assert.equal(memo?.style.autoHeight, true);
});

test("SPEC-TPL-04: print date repeats on pages created by auto-height/table pagination", () => {
  const printedAt = generateTemplate(job).pages[0].elements.find((element) => element.id === "auto-printed-at");
  assert.equal(printedAt?.repeatPerPage, true);
});
