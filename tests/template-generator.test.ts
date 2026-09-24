import assert from "node:assert/strict";
import test from "node:test";
import { generateTemplate } from "../src/core/template-generator.ts";

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

test("SPEC-TPL-01: generated template uses engine page schema and required sections", () => {
  const template = generateTemplate(job);
  assert.equal(template.pages.length, 1);
  assert.deepEqual(template.canvasSize, { width: 794, height: 1123 });
  const types = template.pages[0].elements.map((element) => element.type);
  assert.deepEqual(types, ["text", "line", "text", "text", "text", "text", "table", "text"]);
});

test("SPEC-TPL-03: short and long fields use distinct layout rows", () => {
  const elements = generateTemplate(job).pages[0].elements;
  const customer = elements.find((element) => element.id === "auto-field-1");
  const note = elements.find((element) => element.id === "auto-long-note");
  assert.equal(customer?.content, "客户：@客户");
  assert.equal(note?.content, "备注：@备注");
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
  assert.equal(table?.variable, "@明细");
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
  assert.deepEqual(fieldSources?.children.find((source) => source.id === "明细"), {
    id: "明细",
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
