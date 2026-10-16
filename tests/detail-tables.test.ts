import assert from "node:assert/strict";
import test from "node:test";
import { detailTokensFromTemplate, renderDetailTemplateRows } from "../src/core/detail-tables.ts";
import { expandLinkedRecords, linkedColumnKey } from "../src/core/linked-records.ts";
import { createPrintJobDataSourceTokenCodec, getDocumentVariables, buildDataSourceCatalog,
  detailFieldDataSourceId, prepareTemplateForOutput } from "../src/core/data-sources.ts";
import { bindPrintJob, getPersistentTemplateData } from "../src/engine/designer-adapter.ts";
import type { DesignerElement } from "../src/engine/designer-adapter.ts";
import type { NormalizedField, PrintJob } from "../src/core/print-job.ts";
import { createTemplateRepository } from "../src/core/template-repository.ts";
import { generateTemplate } from "../src/core/template-generator.ts";

const field: NormalizedField = { id: "lines", name: "订单明细", type: "18", isLink: true, linkKind: "detail",
  detailColumns: [{ field: linkedColumnKey("product"), header: "商品" }, { field: linkedColumnKey("qty"), header: "数量" }] };
const product = `@${detailFieldDataSourceId("lines", linkedColumnKey("product"))}`;
const qty = `@${detailFieldDataSourceId("lines", linkedColumnKey("qty"))}`;
function job(): PrintJob { return { source: { baseId: "b", tableId: "t", recordIds: ["a", "b"] },
  table: { name: "订单", fields: [field] }, generatedAt: "2026-10-15T00:00:00Z",
  documents: [{ recordId: "a", values: { 订单明细: [
    { [linkedColumnKey("product")]: "苹果", [linkedColumnKey("qty")]: "2" },
    { [linkedColumnKey("product")]: "梨", [linkedColumnKey("qty")]: "5" }] } },
  { recordId: "b", values: { 订单明细: [] } }] }; }
const template = () => ({ pages: [{ id: "p1", elements: [{ id: "table1", type: "table", columns: [
  { field: "a", header: "商品" }, { field: "b", header: "数量" }], data: [], autoPaginate: true,
  detailTemplateRows: [{ a: product, b: { value: `数量：${qty}`, style: { color: "red" } } }] }] }],
  canvasSize: { width: 794, height: 1123 }, ext: { availableVariables: buildDataSourceCatalog([field]) } });

test("copied detail fields have readable qualified labels and stable bindings", () => {
  const source = buildDataSourceCatalog([field])[0].children[0];
  assert.equal(source.children?.[0].label, "订单明细.商品");
  assert.equal(source.children?.[0].id, product.slice(1));
  const codec = createPrintJobDataSourceTokenCodec(job());
  assert.equal(codec.toEditingContent(product).content, "@订单明细.商品");
  assert.equal(codec.toPersistentContent("@订单明细.商品").content, product);
});

test("a template row repeats as records, keeps row correspondence and styles, and handles empty batches", () => {
  const source = template();
  const codec = createPrintJobDataSourceTokenCodec(job());
  const definitions = detailTokensFromTemplate(source);
  const rows = source.pages[0].elements[0].detailTemplateRows;
  const rendered = renderDetailTemplateRows(rows, definitions, getDocumentVariables(job(), 0), codec);
  assert.deepEqual(rendered.map((row) => row.a), ["苹果", "梨"]);
  assert.deepEqual(rendered.map((row) => row.b.value), ["数量：2", "数量：5"]);
  assert.equal(rendered[1].b.style.color, "red");
  assert.equal(rows[0].a, product);
  assert.deepEqual(renderDetailTemplateRows(rows, definitions, getDocumentVariables(job(), 1), codec), []);
});

test("adjacent loop rows repeat together and fixed rows stay outside the loop", () => {
  const rows = [{ a: "开始" }, { a: product }, { a: qty }, { a: "结束" }];
  const result = renderDetailTemplateRows(rows, detailTokensFromTemplate(template()), getDocumentVariables(job(), 0), createPrintJobDataSourceTokenCodec(job()));
  assert.deepEqual(result.map((row) => row.a), ["开始", "苹果", "2", "梨", "5", "结束"]);
});

test("mixed sources in one row and missing source data fail explicitly", () => {
  const definitions = [...detailTokensFromTemplate(template()), { id: "__duowei_field_other.__duowei_column_x", sourceId: "other", column: "x" }];
  const codec = createPrintJobDataSourceTokenCodec(job());
  assert.throws(() => renderDetailTemplateRows([{ a: product, b: "@__duowei_field_other.__duowei_column_x" }], definitions, {}, codec), /不能混用/);
  assert.throws(() => renderDetailTemplateRows([{ a: product }], definitions, {}, codec), /不可读取/);
});

test("output uses per-document row variables, never embeds rendered business values in the template", () => {
  const first = prepareTemplateForOutput(template(), getDocumentVariables(job(), 0), createPrintJobDataSourceTokenCodec(job()));
  const second = prepareTemplateForOutput(template(), getDocumentVariables(job(), 1), createPrintJobDataSourceTokenCodec(job()));
  assert.equal((first.variables.__duowei_detail_rows_0_0 as unknown[]).length, 2);
  assert.deepEqual(second.variables.__duowei_detail_rows_0_0, []);
  assert.ok(!JSON.stringify(first.template).includes("苹果"));
});

test("editing and persistence round-trip a copied detail cell without persisting business rows", async () => {
  let current: any;
  const designer = { loadTemplateData(value: unknown) { current = structuredClone(value); return true; },
    getTemplateData() { return current; }, async setTestData() {}, async setVariables() {} } as unknown as DesignerElement;
  await bindPrintJob(designer, template(), job());
  assert.equal(current.pages[0].elements[0].data[0].a, "@订单明细.商品");
  current.pages[0].elements[0].data[0].b.value = "件数：@订单明细.数量";
  const saved: any = getPersistentTemplateData(designer);
  assert.deepEqual(saved.pages[0].elements[0].data, []);
  assert.equal(saved.pages[0].elements[0].detailTemplateRows[0].b.value, `件数：${qty}`);
  assert.ok(!JSON.stringify(saved).includes("苹果"));
  await bindPrintJob(designer, saved, job());
  assert.equal(current.pages[0].elements[0].data[0].b.value, "件数：@订单明细.数量");
});

test("all linked columns are selectable beyond five and IDs survive target-field renaming", async () => {
  const fields = Array.from({ length: 7 }, (_, i) => ({ id: `f${i}`, name: `列${i}` }));
  const reader = { async getOrderedFields() { return fields; }, async getCellText(recordId: string, fieldId: string) { return `${recordId}/${fieldId}`; } };
  const first = await expandLinkedRecords({ tableId: "t", recordIds: ["b", "a"], text: "" }, reader, { includeAllFields: true });
  assert.equal(first.detailColumns?.length, 7);
  assert.deepEqual(first.rows.map((row) => row[linkedColumnKey("f6")]), ["b/f6", "a/f6"]);
  fields[6].name = "改名后的列";
  const renamed = await expandLinkedRecords({ tableId: "t", recordIds: ["b"], text: "" }, reader, { includeAllFields: true });
  assert.equal(renamed.rows[0][linkedColumnKey("f6")], first.rows[0][linkedColumnKey("f6")]);
  assert.equal(renamed.detailColumns?.[6].header, "改名后的列");
});

test("automatic linked tables use editable template rows instead of business sample cells", () => {
  const generated = generateTemplate(job());
  const table = generated.pages.flatMap((page) => page.elements).find((element) => element.type === "table")!;
  assert.deepEqual(table.data, []);
  assert.equal((table.detailTemplateRows as any[])[0][linkedColumnKey("product")], product);
  assert.ok(!JSON.stringify(generated).includes("苹果"));
});

test("repository saves and reloads detail row definitions while discarding runtime data", async () => {
  const storage = new Map<string, unknown>();
  const repository = createTemplateRepository({ async getData<T>(key: string) { return storage.get(key) as T; },
    async setData<T>(key: string, value: T) { storage.set(key, structuredClone(value)); return true; } });
  const source: any = template();
  source.pages[0].elements[0].data = [{ a: "业务数据不可保存" }];
  const saved = await repository.save({ baseId: "b", tableId: "t" }, source, { expectedChecksum: null });
  const loaded: any = (await repository.load({ baseId: "b", tableId: "t" }))!.template;
  assert.equal(loaded.pages[0].elements[0].detailTemplateRows[0].a, product);
  assert.deepEqual(loaded.pages[0].elements[0].data, []);
  assert.ok(!JSON.stringify(saved).includes("业务数据不可保存"));
});
