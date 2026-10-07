import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  bindPrintJob,
  bindStoredTemplateOrFallback,
  composeRenderedPrintPages,
  exportPrintJob,
  getPrintPreviewHtml,
  getPersistentTemplateData,
  installDataSourceEditingLifecycle,
  previewPrintJob,
  renderPrintJobPages,
  renderLabelPrintJobPages,
  getLabelPrintJobPdfBlob,
  renderContinuousPrintJobPages,
  getContinuousPrintJobPdfBlob,
  renderPrintJobCandidate,
  restorePrintJobVariables,
  renderedPreviewHeight,
  isRenderedPrintJobCurrent,
  printRenderedPages,
  printPrintJob,
  rememberCopiedDataSource,
  synchronizeDesignerDataSources,
  installDesignerPrintInterception,
  installDesignerSaveInterception,
  installDesignerWorkspaceChrome,
  installDesignerTemplatePanelSuppression,
  renameDataSourceCopy,
  type DesignerElement,
} from "../src/engine/designer-adapter.ts";
import { generateContinuousTemplate } from "../src/core/template-generator.ts";
import type { PrintJob } from "../src/core/print-job.ts";
import {
  buildDataSourceClipboardPayload,
  fieldDataSourceId,
  SYSTEM_PRINT_DATE_ID,
} from "../src/core/data-sources.ts";

test("SPEC-TPL-01: binding feeds real values to editor preview and print variables", async () => {
  const calls: string[] = [];
  const payloads: Record<string, unknown>[] = [];
  let loadedTemplate: any;
  const designer = {
    loadTemplateData(template: unknown) {
      calls.push("template");
      loadedTemplate = template;
      return true;
    },
    async setTestData(data: Record<string, unknown>) {
      calls.push("testData");
      payloads.push(data);
    },
    async setVariables(data: Record<string, unknown>) {
      calls.push("variables");
      payloads.push(data);
    },
  } as unknown as DesignerElement;
  const job: PrintJob = {
    source: { baseId: "base", tableId: "table", recordIds: ["rec"] },
    table: { name: "订单", fields: [{ id: "customer", name: "客户", type: "1" }] },
    documents: [{ recordId: "rec", values: { 客户: "甲" } }],
    generatedAt: "2026-09-21T10:00:00.000Z",
  };

  await bindPrintJob(designer, null, job);
  assert.deepEqual(calls, ["template", "testData", "variables"]);
  assert.deepEqual(loadedTemplate.ext.availableVariables, [
    {
      id: "__duowei_fields",
      label: "字段",
      children: [{ id: fieldDataSourceId("customer"), label: "客户" }],
    },
    {
      id: "__duowei_system",
      label: "系统",
      children: [{ id: SYSTEM_PRINT_DATE_ID, label: "打印日期" }],
    },
  ]);
  const expected = {
    客户: "甲",
    [fieldDataSourceId("customer")]: "甲",
    [SYSTEM_PRINT_DATE_ID]: "2026-09-21",
    打印日期: "2026-09-21",
    "__duowei_render_auto-field-1": "客户：甲",
    "__duowei_render_auto-printed-at": "打印日期：2026-09-21",
  };
  assert.deepEqual(payloads, [expected, expected]);
});

test("CT-DES-06: binding loads friendly editor content, resolved canvas data, and keeps a stable save snapshot", async () => {
  const orderToken = `@${fieldDataSourceId("order-no")}`;
  const customerToken = `@${fieldDataSourceId("customer")}`;
  let loadedTemplate: any;
  let testData: Record<string, unknown> = {};
  const designer = {
    loadTemplateData(template: unknown) { loadedTemplate = structuredClone(template); return true; },
    getTemplateData() { return structuredClone(loadedTemplate); },
    async setTestData(data: Record<string, unknown>) { testData = data; },
    async setVariables() {},
    setAvailableVariables() {},
  } as unknown as DesignerElement;
  const job: PrintJob = {
    source: { baseId: "base", tableId: "table", recordIds: ["rec"] },
    table: { name: "订单", fields: [
      { id: "order-no", name: "订单编号", type: "1" },
      { id: "customer", name: "客户名称", type: "1" },
    ] },
    documents: [{ recordId: "rec", values: { 订单编号: "PO-0001", 客户名称: "甲公司" } }],
    generatedAt: "2026-09-26T10:00:00.000Z",
  };
  const persistent = {
    pages: [{ id: "p", elements: [{
      id: "summary", type: "text",
      content: `订单：${orderToken}，客户：${customerToken}`,
      variable: orderToken,
    }] }],
    canvasSize: { width: 794, height: 1123 },
  };

  await bindPrintJob(designer, persistent, job);

  const runtimeElement = loadedTemplate.pages[0].elements[0];
  assert.equal(runtimeElement.content, "订单：@订单编号，客户：@客户名称");
  assert.match(runtimeElement.variable, /^@__duowei_render_/);
  assert.equal(testData[runtimeElement.variable.slice(1)], "订单：PO-0001，客户：甲公司");
  const saved = getPersistentTemplateData(designer);
  assert.equal((saved.pages as any)[0].elements[0].content, persistent.pages[0].elements[0].content);
  assert.equal((saved.pages as any)[0].elements[0].variable, orderToken);
  assert.ok(!JSON.stringify(saved).includes("PO-0001"));
});

test("CT-DES-06: locked engine contract exposes textarea edit and blur commit but no public edit lifecycle", () => {
  const bundle = readFileSync("node_modules/vue-print-designer/dist/web-component-zZPzxxzQ.js", "utf8");
  const types = readFileSync("node_modules/vue-print-designer/dist/web-component.d.ts", "utf8");
  assert.match(bundle, /__name: "TextElement"/);
  assert.match(bundle, /createElementBlock\("textarea"/);
  assert.match(bundle, /onBlur: commitInlineEdit/);
  assert.match(bundle, /editingValue\.value = props\.element\.content \|\| ""/);
  assert.doesNotMatch(types, /onTextEdit|setTextContent|updateElement/);
});

test("CT-DES-06: blur synchronization resolves added friendly fields and preserves stable save data", async () => {
  const orderToken = `@${fieldDataSourceId("order-no")}`;
  const customerToken = `@${fieldDataSourceId("customer")}`;
  let loadedTemplate: any;
  let testData: Record<string, unknown> = {};
  const designer = {
    loadTemplateData(template: unknown) { loadedTemplate = structuredClone(template); return true; },
    getTemplateData() { return structuredClone(loadedTemplate); },
    async setTestData(data: Record<string, unknown>) { testData = data; },
    async setVariables() {},
    setAvailableVariables() {},
  } as unknown as DesignerElement;
  const job: PrintJob = {
    source: { baseId: "base", tableId: "table", recordIds: ["rec"] },
    table: { name: "订单", fields: [
      { id: "order-no", name: "订单编号", type: "1" },
      { id: "customer", name: "客户名称", type: "1" },
    ] },
    documents: [{ recordId: "rec", values: { 订单编号: "PO-0001", 客户名称: "甲公司" } }],
    generatedAt: "2026-09-26T10:00:00.000Z",
  };
  await bindPrintJob(designer, {
    pages: [{ id: "p", elements: [{
      id: "summary", type: "text", content: `订单：${orderToken}`, variable: orderToken,
    }] }],
    canvasSize: { width: 794, height: 1123 },
  }, job);

  loadedTemplate.pages[0].elements[0].content = "订单：@订单编号，客户：@客户名称";
  loadedTemplate.pages[0].elements[0].variable = "";
  await synchronizeDesignerDataSources(designer);

  const runtimeElement = loadedTemplate.pages[0].elements[0];
  assert.equal(runtimeElement.content, "订单：@订单编号，客户：@客户名称");
  assert.equal(testData[runtimeElement.variable.slice(1)], "订单：PO-0001，客户：甲公司");
  const saved = getPersistentTemplateData(designer);
  assert.equal((saved.pages as any)[0].elements[0].content,
    `订单：${orderToken}，客户：${customerToken}`);
  assert.ok(!JSON.stringify(saved).includes("PO-0001"));
});

test("CT-DES-06: paste and focusout events complete the friendly edit, stable save, and reload lifecycle", async () => {
  const orderToken = `@${fieldDataSourceId("order-no")}`;
  const customerToken = `@${fieldDataSourceId("customer")}`;
  const root = new EventTarget();
  let loadedTemplate: any;
  let testData: Record<string, unknown> = {};
  let changes = 0;
  const designer = {
    shadowRoot: root,
    loadTemplateData(template: unknown) { loadedTemplate = structuredClone(template); return true; },
    getTemplateData() { return structuredClone(loadedTemplate); },
    async setTestData(data: Record<string, unknown>) { testData = data; },
    async setVariables() {},
    setAvailableVariables() {},
  } as unknown as DesignerElement;
  const job: PrintJob = {
    source: { baseId: "base", tableId: "table", recordIds: ["rec"] },
    table: { name: "订单", fields: [
      { id: "order-no", name: "订单编号", type: "1" },
      { id: "customer", name: "客户名称", type: "1" },
    ] },
    documents: [{ recordId: "rec", values: { 订单编号: "PO-0001", 客户名称: "甲公司" } }],
    generatedAt: "2026-09-26T10:00:00.000Z",
  };
  const stop = installDataSourceEditingLifecycle(designer, {
    onChange: () => { changes += 1; },
  });
  await bindPrintJob(designer, {
    pages: [{ id: "p", elements: [{
      id: "summary", type: "text", content: `订单：${orderToken}`, variable: orderToken,
    }] }],
    canvasSize: { width: 794, height: 1123 },
  }, job);

  const payload = buildDataSourceClipboardPayload({
    id: fieldDataSourceId("customer"),
    label: "客户名称",
  });
  rememberCopiedDataSource(designer, payload);
  const wrapper = { getAttribute: (name: string) => name === "data-element-id" ? "summary" : null };
  const textarea = {
    tagName: "TEXTAREA",
    selectionStart: 16,
    closest: (selector: string) => selector === ".element-wrapper[data-element-id]"
      ? wrapper
      : selector === ".element-wrapper[data-element-id] [data-text-content]" ? {} : null,
  };
  const paste = new Event("paste");
  Object.defineProperties(paste, {
    composedPath: { value: () => [textarea, root] },
    clipboardData: { value: { getData: () => payload.text } },
  });
  root.dispatchEvent(paste);

  loadedTemplate.pages[0].elements[0].content = "订单：@订单编号，客户：@客户名称";
  const focusout = new Event("focusout");
  Object.defineProperty(focusout, "composedPath", { value: () => [textarea, root] });
  root.dispatchEvent(focusout);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(changes, 1);
  const runtimeElement = loadedTemplate.pages[0].elements[0];
  assert.equal(runtimeElement.content, "订单：@订单编号，客户：@客户名称");
  assert.equal(testData[runtimeElement.variable.slice(1)], "订单：PO-0001，客户：甲公司");
  const saved = getPersistentTemplateData(designer);
  assert.equal((saved.pages as any)[0].elements[0].content,
    `订单：${orderToken}，客户：${customerToken}`);
  assert.ok(!JSON.stringify(saved).includes("PO-0001"));

  const renamedJob = structuredClone(job);
  renamedJob.table.fields[1].name = "客户全称";
  renamedJob.documents[0].values = { 订单编号: "PO-0002", 客户全称: "乙公司" };
  await bindPrintJob(designer, saved, renamedJob);
  assert.equal(loadedTemplate.pages[0].elements[0].content, "订单：@订单编号，客户：@客户全称");
  assert.equal(testData[loadedTemplate.pages[0].elements[0].variable.slice(1)],
    "订单：PO-0002，客户：乙公司");
  stop();
});

test("CT-DES-06: saving does not clear unrelated engine text variables", async () => {
  let template: any;
  const designer = {
    loadTemplateData(value: unknown) { template = structuredClone(value); return true; },
    getTemplateData() { return structuredClone(template); },
    async setTestData() {},
    async setVariables() {},
  } as unknown as DesignerElement;
  const job = outputJob(["rec-1"]);
  await bindPrintJob(designer, {
    pages: [{ id: "p", elements: [
      { id: "ordinary", type: "text", content: "固定文本", variable: "@__duowei_custom" },
      { id: "unbound", type: "text", content: "没有数据源" },
    ] }],
    canvasSize: { width: 794, height: 1123 },
  }, job);

  const saved = getPersistentTemplateData(designer);
  assert.deepEqual((saved.pages as any)[0].elements, [
    { id: "ordinary", type: "text", content: "固定文本", variable: "@__duowei_custom" },
    { id: "unbound", type: "text", content: "没有数据源" },
  ]);
});

test("SPEC-DES-02/SRC-04: an unresolvable saved binding falls back read-only without losing live data", async () => {
  const job = outputJob(["rec-1"]);
  const loaded: any[] = [];
  const values: Record<string, unknown>[] = [];
  const designer = {
    loadTemplateData(template: unknown) { loaded.push(template); return true; },
    async setTestData(data: Record<string, unknown>) { values.push(data); },
    async setVariables(data: Record<string, unknown>) { values.push(data); },
  } as unknown as DesignerElement;
  const legacy = {
    pages: [{ id: "p", elements: [{ type: "text", variable: "@已改名字段" }] }],
    canvasSize: { width: 794, height: 1123 },
  };

  const warning = await bindStoredTemplateOrFallback(designer, legacy, job);
  assert.match(warning ?? "", /无法识别旧字段绑定/);
  assert.equal(loaded.length, 1);
  assert.deepEqual(values[0], values[1]);
  assert.equal(values[0][fieldDataSourceId("customer")], "rec-1");
  assert.equal(legacy.pages[0].elements[0].variable, "@已改名字段");
});

function outputJob(recordIds: string[]): PrintJob {
  return {
    source: { baseId: "base", tableId: "table", recordIds },
    table: { name: "订单", fields: [{ id: "customer", name: "客户", type: "1" }] },
    documents: recordIds.map((recordId) => ({ recordId, values: { 客户: recordId } })),
    generatedAt: "2026-09-21T10:00:00.000Z",
  };
}

function expectedVariables(customer: string) {
  return {
    客户: customer,
    [fieldDataSourceId("customer")]: customer,
    [SYSTEM_PRINT_DATE_ID]: "2026-09-21",
    打印日期: "2026-09-21",
  };
}

function testPdfBlob(pageCount = 1) {
  const pages = Array.from({ length: pageCount }, (_, index) =>
    `${index + 1} 0 obj\n<< /Type /Page >>\nendobj`).join("\n");
  return new Blob([`%PDF-1.4\n${pages}\n%%EOF`], { type: "application/pdf" });
}

function sizedPdfBlob() {
  return new Blob([
    "%PDF-1.4\n",
    "1 0 obj\n<< /Type /Page /MediaBox [0 0 595.92 1039.92] >>\nendobj\n",
    "2 0 obj\n<< /Type /Page /MediaBox [0 0 595.92 1039.92] >>\nendobj\n",
    "%%EOF",
  ], { type: "application/pdf" });
}

function installPdfDownloadMock(calls: unknown[] = []) {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalUrl = Object.getOwnPropertyDescriptor(globalThis, "URL");
  const anchor = {
    download: "",
    href: "",
    rel: "",
    style: { display: "" },
    click() { calls.push(["download", this.download, this.href]); },
    remove() { calls.push("removeDownloadLink"); },
  };
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement(tag: string) {
      assert.equal(tag, "a");
      return anchor;
    },
    body: { appendChild(value: unknown) { calls.push(["appendDownloadLink", value === anchor]); } },
  } });
  Object.defineProperty(globalThis, "URL", { configurable: true, value: {
    createObjectURL(blob: Blob) {
      calls.push(["createObjectURL", blob.size]);
      return "blob:duowei-pdf";
    },
    revokeObjectURL(url: string) { calls.push(["revokeObjectURL", url]); },
  } });
  return () => {
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (originalUrl) Object.defineProperty(globalThis, "URL", originalUrl);
    else Reflect.deleteProperty(globalThis, "URL");
  };
}

test("SPEC-SRC-02: designer terminology calls the variable catalog data sources", () => {
  assert.equal(renameDataSourceCopy("可用变量"), "数据源");
  assert.equal(renameDataSourceCopy(" Available Variables "), " Data Sources ");
  assert.equal(renameDataSourceCopy("变量"), "变量");
});

test("SPEC-OUT-01/02: a single document uses rendered HTML and PDF export APIs", async () => {
  const calls: Array<[string, unknown]> = [];
  const downloadCalls: unknown[] = [];
  const designer = {
    async setVariables(data: unknown) { calls.push(["setVariables", data]); },
    async getPreviewHtml() { calls.push(["getPreviewHtml", null]); return "<div><div>single</div></div>"; },
    async export(request: unknown) { calls.push(["export", request]); return testPdfBlob(); },
    async printBatch() { calls.push(["printBatch", null]); },
    async exportBatchPdf() { calls.push(["exportBatchPdf", null]); },
  } as unknown as DesignerElement;
  const job = outputJob(["rec-1"]);

  const restorePrintDom = installPrintDomMock();
  await printPrintJob(designer, job);
  restorePrintDom();
  const restoreDownloadDom = installPdfDownloadMock(downloadCalls);
  const result = await exportPrintJob(designer, job, "single.pdf");
  restoreDownloadDom();

  assert.deepEqual(calls, [
    ["setVariables", expectedVariables("rec-1")],
    ["getPreviewHtml", null],
    ["setVariables", expectedVariables("rec-1")],
    ["export", { type: "pdfBlob" }],
  ]);
  assert.deepEqual(result, { filename: "single.pdf", bytes: testPdfBlob().size, pages: 1 });
  assert.deepEqual(downloadCalls.slice(0, 4), [
    ["createObjectURL", testPdfBlob().size],
    ["appendDownloadLink", true],
    ["download", "single.pdf", "blob:duowei-pdf"],
    "removeDownloadLink",
  ]);
});

test("SPEC-OUT-03: PDF export exposes native page dimensions when the blob declares MediaBox", async () => {
  const designer = {
    async setVariables() {},
    async export() { return sizedPdfBlob(); },
  } as unknown as DesignerElement;
  const restoreDownloadDom = installPdfDownloadMock();
  const result = await exportPrintJob(designer, outputJob(["rec-1"]), "sized.pdf");
  restoreDownloadDom();

  assert.deepEqual(result.pageSizes, [
    { width: 595.92, height: 1039.92 },
    { width: 595.92, height: 1039.92 },
  ]);
});

test("SPEC-UX-01: print preview mode uses the real engine HTML without opening a print window", async () => {
  const calls: Array<[string, unknown?]> = [];
  const designer = {
    async setVariables(data: unknown) { calls.push(["setVariables", data]); },
    async getPreviewHtml() { calls.push(["getPreviewHtml"]); return "<article>record</article>"; },
  } as unknown as DesignerElement;

  const html = await getPrintPreviewHtml(designer, outputJob(["rec-1"]));

  assert.equal(html, "<article>record</article>");
  assert.deepEqual(calls, [
    ["setVariables", expectedVariables("rec-1")],
    ["getPreviewHtml"],
  ]);
});

test("SPEC-OUT-02: multi-token text is resolved through a temporary output template and restored", async () => {
  const customerToken = `@${fieldDataSourceId("customer")}`;
  const orderToken = `@${fieldDataSourceId("order-no")}`;
  const canonicalTemplate = {
    pages: [{ id: "p", elements: [{
      id: "summary",
      type: "text",
      content: `客户：${customerToken}，订单号：${orderToken}`,
    }] }],
    canvasSize: { width: 794, height: 1123 },
  };
  const calls: Array<[string, unknown]> = [];
  const designer = {
    getTemplateData() { return canonicalTemplate; },
    loadTemplateData(data: unknown) { calls.push(["load", data]); return true; },
    async setVariables(data: unknown) { calls.push(["variables", data]); },
    async getPreviewHtml() { calls.push(["preview"]); return "<article>甲公司 / PO-0001</article>"; },
  } as unknown as DesignerElement;
  const job: PrintJob = {
    source: { baseId: "base", tableId: "table", recordIds: ["rec"] },
    table: { name: "订单", fields: [
      { id: "customer", name: "客户", type: "1" },
      { id: "order-no", name: "订单编号", type: "1" },
    ] },
    documents: [{ recordId: "rec", values: { 客户: "甲公司", 订单编号: "PO-0001" } }],
    generatedAt: "2026-09-21T10:00:00.000Z",
  };

  const html = await getPrintPreviewHtml(designer, job);

  assert.equal(html, "<article>甲公司 / PO-0001</article>");
  assert.equal(calls[0][0], "load");
  assert.equal((calls[0][1] as any).pages[0].elements[0].content,
    "@__duowei_render_summary");
  assert.equal((calls[1][1] as any).__duowei_render_summary,
    "客户：甲公司，订单号：PO-0001");
  assert.equal(calls[2][0], "preview");
  assert.equal(calls[3][0], "load");
  assert.deepEqual(calls[3][1], canonicalTemplate);
});

test("SPEC-BATCH-02: batch PDF receives per-record values for multi-token text", async () => {
  const customerToken = `@${fieldDataSourceId("customer")}`;
  const orderToken = `@${fieldDataSourceId("order-no")}`;
  const canonicalTemplate = {
    pages: [{ id: "p", elements: [{
      id: "summary",
      type: "text",
      content: `客户：${customerToken}，订单号：${orderToken}`,
    }] }],
    canvasSize: { width: 794, height: 1123 },
  };
  const calls: Array<[string, unknown]> = [];
  const designer = {
    getTemplateData() { return canonicalTemplate; },
    loadTemplateData(data: unknown) { calls.push(["load", data]); return true; },
    async setVariables(data: unknown) { calls.push(["variables", data]); },
    async getBatchPdfBlob(items: unknown, request: unknown) {
      calls.push(["getBatchPdfBlob", { items, request }]);
      return testPdfBlob(2);
    },
  } as unknown as DesignerElement;
  const job: PrintJob = {
    source: { baseId: "base", tableId: "table", recordIds: ["rec-1", "rec-2"] },
    table: { name: "订单", fields: [
      { id: "customer", name: "客户", type: "1" },
      { id: "order-no", name: "订单编号", type: "1" },
    ] },
    documents: [
      { recordId: "rec-1", values: { 客户: "甲公司", 订单编号: "PO-0001" } },
      { recordId: "rec-2", values: { 客户: "乙公司", 订单编号: "PO-0002" } },
    ],
    generatedAt: "2026-09-21T10:00:00.000Z",
  };

  const restoreDownloadDom = installPdfDownloadMock();
  const result = await exportPrintJob(designer, job, "batch.pdf");
  restoreDownloadDom();

  const exportCall = calls.find(([name]) => name === "getBatchPdfBlob");
  assert.ok(exportCall);
  const items = (exportCall?.[1] as any).items;
  assert.equal(items[0].variables.__duowei_render_summary, "客户：甲公司，订单号：PO-0001");
  assert.equal(items[1].variables.__duowei_render_summary, "客户：乙公司，订单号：PO-0002");
  assert.deepEqual(calls.at(-2), ["load", canonicalTemplate]);
  assert.equal(result.pages, 2);
});

test("SPEC-BATCH-02: multiple documents render in order for one print and one batch PDF export", async () => {
  const calls: Array<[string, unknown, unknown?]> = [];
  const designer = {
    async export() { calls.push(["export", null]); },
    async setVariables(data: unknown) { calls.push(["setVariables", data]); },
    async getPreviewHtml() { calls.push(["getPreviewHtml", null]); return "<div><div>page</div></div>"; },
    async printBatch(items: unknown, request: unknown) { calls.push(["printBatch", items, request]); },
    async getBatchPdfBlob(items: unknown, request: unknown) {
      calls.push(["getBatchPdfBlob", items, request]);
      return testPdfBlob(3);
    },
  } as unknown as DesignerElement;
  const job = outputJob(["rec-1", "rec-2", "rec-3"]);

  const restorePrintDom = installPrintDomMock();
  await printPrintJob(designer, job);
  restorePrintDom();
  const restoreDownloadDom = installPdfDownloadMock();
  const result = await exportPrintJob(designer, job, "batch.pdf");
  restoreDownloadDom();

  const expectedItems = [
    { variables: expectedVariables("rec-1") },
    { variables: expectedVariables("rec-2") },
    { variables: expectedVariables("rec-3") },
  ];
  assert.deepEqual(calls, [
    ...expectedItems.flatMap(({ variables }) => [["setVariables", variables], ["getPreviewHtml", null]]),
    ["setVariables", expectedVariables("rec-1")],
    ["getBatchPdfBlob", expectedItems, { filename: "batch.pdf" }],
  ]);
  assert.equal(result.pages, 3);
});

test("SPEC-OUT-02: invalid PDF bytes are rejected before browser download", async () => {
  const calls: unknown[] = [];
  const designer = {
    async setVariables() {},
    async export() { return new Blob(["not a pdf"], { type: "application/pdf" }); },
  } as unknown as DesignerElement;
  const restoreDownloadDom = installPdfDownloadMock(calls);
  await assert.rejects(() => exportPrintJob(designer, outputJob(["rec-1"]), "broken.pdf"),
    /PDF 文件无效/);
  restoreDownloadDom();
  assert.equal(calls.length, 0);
});

test("SPEC-OUT-01: browser print uses engine HTML and the current document, without blob navigation", async () => {
  const calls: unknown[] = [];
  const designer = {
    async setVariables() {},
    async getPreviewHtml() { calls.push("getPreviewHtml"); return "<div><div>page</div></div>"; },
  } as unknown as DesignerElement;
  const restorePrintDom = installPrintDomMock(calls);

  await printPrintJob(designer, outputJob(["rec-1"]));

  restorePrintDom();
  assert.deepEqual(calls, ["getPreviewHtml", "createPrintRoot", "appendPrintRoot", "documentPrint"]);
});

test("SPEC-OUT-01/BUG-0002: composed output creates one explicit print box per engine page", () => {
  const originalParser = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
  const pages = [
    { tagName: "STYLE", cloneNode() {
      return { outerHTML: "<style>.engine-page{color:black}</style>" };
    } },
    { tagName: "DIV", cloneNode() {
      return { style: { setProperty() {} }, outerHTML: '<div data-page="1">one</div>' };
    } },
    { tagName: "DIV", cloneNode() {
      return { style: { setProperty() {} }, outerHTML: '<div data-page="2">two</div>' };
    } },
  ];
  Object.defineProperty(globalThis, "DOMParser", { configurable: true, value: class {
    parseFromString() {
      return { body: { firstElementChild: { children: pages } } };
    }
  } });
  try {
    const html = composeRenderedPrintPages({
      recordIds: ["rec-1"],
      pages: ["<div><div data-page=\"1\">one</div><div data-page=\"2\">two</div></div>"],
      pageCounts: [2],
      canvasWidth: 400,
      canvasHeight: 600,
    });
    assert.equal((html.match(/class=\"duowei-print-document\"/g) ?? []).length, 2);
    assert.match(html, /<style>\.engine-page\{color:black\}<\/style>/);
    assert.match(html, /data-page=\"1\"/);
    assert.match(html, /data-page=\"2\"/);
    assert.doesNotMatch(html, /duowei-print-document > div > div/);
  } finally {
    if (originalParser) Object.defineProperty(globalThis, "DOMParser", originalParser);
    else Reflect.deleteProperty(globalThis, "DOMParser");
  }
});

test("SPEC-BATCH-02: browser batch print invokes one document print", async () => {
  const calls: unknown[] = [];
  const designer = {
    async setVariables(data: unknown) { calls.push(["setVariables", data]); },
    async getPreviewHtml() { calls.push("getPreviewHtml"); return "<div><div>page</div></div>"; },
  } as unknown as DesignerElement;
  const restorePrintDom = installPrintDomMock(calls);

  await printPrintJob(designer, outputJob(["rec-1", "rec-2"]));

  restorePrintDom();
  assert.equal(calls.filter((call) => call === "documentPrint").length, 1);
  assert.equal(calls.filter((call) => call === "getPreviewHtml").length, 2);
});

test("CT-BATCH-04: one ordered rendered batch serves both preview and one browser print", async () => {
  const calls: unknown[] = [];
  let customer = "";
  const designer = {
    async setVariables(data: Record<string, unknown>) {
      customer = String(data.客户);
      calls.push(["variables", customer]);
    },
    async getPreviewHtml() { calls.push("render"); return `<div><div>${customer}</div></div>`; },
    getTemplateData() { return { canvasSize: { width: 400, height: 600 } }; },
  } as unknown as DesignerElement;
  const rendered = await renderPrintJobPages(designer, outputJob(["rec-3", "rec-1", "rec-2"]));
  const preview = composeRenderedPrintPages(rendered);
  assert.deepEqual(rendered.recordIds, ["rec-3", "rec-1", "rec-2"]);
  assert.equal(rendered.pages.length, 3);
  assert.equal((preview.match(/duowei-print-document/g) ?? []).length, 3);
  assert.deepEqual([...preview.matchAll(/<div><div>(rec-\d)<\/div><\/div>/g)].map((match) => match[1]),
    ["rec-3", "rec-1", "rec-2"]);
  assert.equal(renderedPreviewHeight(rendered), 1872);
  const renderCalls = calls.filter((call) => call === "render").length;
  const restore = installPrintDomMock(calls);
  try {
    await printRenderedPages(rendered);
  } finally {
    restore();
  }
  assert.equal(calls.filter((call) => call === "render").length, renderCalls);
  assert.equal(calls.filter((call) => call === "documentPrint").length, 1);
});

test("SPEC-LABEL-01/02: native label render paginates seven records and restores the editable template", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
  Object.defineProperty(globalThis, "DOMParser", { configurable: true, value: class {
    parseFromString() { return { body: { firstElementChild: { children: [
      { tagName: "STYLE" }, { tagName: "DIV" }, { tagName: "DIV" },
    ] } } }; }
  } });
  const token = `@${fieldDataSourceId("customer")}`;
  const template = { canvasSize: { width: 600, height: 400 }, pages: [{ elements: [
    { id: "grid", type: "multiLabel", x: 20, y: 20, width: 170, height: 100,
      rows: 2, cols: 3, gapX: 20, gapY: 20, direction: "row", dataVariable: "@labels" },
    { id: "text", type: "text", x: 30, y: 30, width: 140, height: 30,
      content: `客户：${token}`, variable: token },
  ] }] };
  const calls: string[] = [];
  let current: any = template;
  let variables: Record<string, unknown> = {};
  const designer = {
    getTemplateData() { return current; },
    loadTemplateData(data: any) { current = data; calls.push("load"); return true; },
    async setVariables(data: Record<string, unknown>) { variables = data; calls.push("variables"); },
    async getPreviewHtml() {
      calls.push("render");
      assert.equal((variables.labels as unknown[]).length, 7);
      return "<div><div>six labels</div><div>one label</div></div>";
    },
    async export(request: unknown) {
      calls.push("export");
      assert.deepEqual(request, { type: "pdfBlob" });
      return testPdfBlob(2);
    },
    async exportBatchPdf() { throw new Error("must not export individual documents"); },
  } as unknown as DesignerElement;
  const job = outputJob(Array.from({ length: 7 }, (_, i) => `rec-${i + 1}`));
  try {
    const rendered = await renderLabelPrintJobPages(designer, job);
    assert.equal(rendered.layout, "labels");
    assert.equal(rendered.pages.length, 1);
    assert.deepEqual(rendered.pageCounts, [2]);
    assert.equal(isRenderedPrintJobCurrent(rendered, job, "labels"), true);
    assert.equal(isRenderedPrintJobCurrent(rendered, job), false);
    assert.equal(current, template);
    const blob = await getLabelPrintJobPdfBlob(designer, job);
    assert.equal(blob.size, testPdfBlob(2).size);
    assert.deepEqual(calls, ["load", "variables", "render", "load", "variables",
      "load", "variables", "export", "load", "variables"]);
    assert.equal(current, template);
  } finally {
    if (original) Object.defineProperty(globalThis, "DOMParser", original);
    else Reflect.deleteProperty(globalThis, "DOMParser");
  }
});

test("SPEC-LABEL-01: one record occupies one native label page without changing the template", async () => {
  const originalParser = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
  Object.defineProperty(globalThis, "DOMParser", { configurable: true, value: class {
    parseFromString() { return { body: { firstElementChild: { children: [
      { tagName: "STYLE" }, { tagName: "DIV" },
    ] } } }; }
  } });
  const template = { canvasSize: { width: 600, height: 400 }, pages: [{ elements: [
    { type: "multiLabel", x: 20, y: 20, width: 170, height: 100,
      rows: 2, cols: 3, gapX: 20, gapY: 20, direction: "row", dataVariable: "@labels" },
    { id: "text", type: "text", x: 30, y: 30, width: 140, height: 30,
      content: `@${fieldDataSourceId("customer")}` },
  ] }] };
  let current: any = template;
  const designer = {
    getTemplateData() { return current; },
    loadTemplateData(data: any) { current = data; return true; },
    async setVariables() {},
    async getPreviewHtml() { return "<div><style></style><div>one label</div></div>"; },
  } as unknown as DesignerElement;
  try {
    const rendered = await renderPrintJobPages(designer, outputJob(["rec-1"]));
    assert.equal(rendered.layout, "labels");
    assert.deepEqual(rendered.pageCounts, [1]);
    assert.equal(current, template);
  } finally {
    if (originalParser) Object.defineProperty(globalThis, "DOMParser", originalParser);
    else Reflect.deleteProperty(globalThis, "DOMParser");
  }
});

test("SPEC-CONT-02/03: native continuous render uses one long page and restores the editable template", async () => {
  const originalParser = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
  Object.defineProperty(globalThis, "DOMParser", { configurable: true, value: class {
    parseFromString() { return { body: { firstElementChild: { children: [
      { tagName: "STYLE" }, { tagName: "DIV" },
    ] } } }; }
  } });
  const job = outputJob(["rec-1", "rec-2", "rec-3"]);
  const template = generateContinuousTemplate(job);
  let current: any = template;
  let variables: Record<string, unknown> = {};
  const calls: string[] = [];
  const designer = {
    getTemplateData() { return current; },
    loadTemplateData(data: any) { current = data; calls.push("load"); return true; },
    async setVariables(data: Record<string, unknown>) { variables = data; calls.push("variables"); },
    async getPreviewHtml() {
      assert.equal((variables.__duowei_continuous_rows as unknown[]).length, 3);
      return "<div><style></style><div>continuous sheet</div></div>";
    },
    async export(request: unknown) {
      calls.push("export");
      assert.deepEqual(request, { type: "pdfBlob" });
      return testPdfBlob();
    },
  } as unknown as DesignerElement;
  try {
    const rendered = await renderContinuousPrintJobPages(designer, job);
    assert.equal(rendered.layout, "continuous");
    assert.deepEqual(rendered.pageCounts, [1]);
    assert.equal(rendered.pages.length, 1);
    assert.equal(rendered.canvasHeight, template.canvasSize.height * 3);
    assert.equal(isRenderedPrintJobCurrent(rendered, job, "continuous"), true);
    assert.equal(current, template);
    const blob = await getContinuousPrintJobPdfBlob(designer, job);
    assert.equal(blob.size, testPdfBlob().size);
    assert.equal(current, template);
    assert.ok(calls.includes("export"));
  } finally {
    if (originalParser) Object.defineProperty(globalThis, "DOMParser", originalParser);
    else Reflect.deleteProperty(globalThis, "DOMParser");
  }
});

test("SPEC-LABEL-03: a failed native label render restores the template and does not expose a partial batch", async () => {
  const token = `@${fieldDataSourceId("customer")}`;
  const template = { canvasSize: { width: 600, height: 400 }, pages: [{ elements: [
    { id: "grid", type: "multiLabel", x: 20, y: 20, width: 170, height: 100,
      rows: 2, cols: 3, gapX: 20, gapY: 20, direction: "row", dataVariable: "@labels" },
    { id: "text", type: "text", x: 30, y: 30, width: 140, height: 30,
      content: token, variable: token },
  ] }] };
  let current: any = template;
  const designer = {
    getTemplateData() { return current; },
    loadTemplateData(data: any) { current = data; return true; },
    async setVariables() {},
    async getPreviewHtml() { throw new Error("render failed"); },
  } as unknown as DesignerElement;
  await assert.rejects(() => renderPrintJobPages(designer, outputJob(["rec-1"])), /render failed/);
  assert.equal(current, template);
});

test("SPEC-LABEL-03: failed label reselection restores committed values", async () => {
  const token = `@${fieldDataSourceId("customer")}`;
  const template = { canvasSize: { width: 600, height: 400 }, pages: [{ elements: [
    { type: "multiLabel", x: 20, y: 20, width: 170, height: 100,
      rows: 2, cols: 3, gapX: 20, gapY: 20, direction: "row", dataVariable: "@labels" },
    { id: "text", type: "text", x: 30, y: 30, width: 140, height: 30,
      content: token, variable: token },
  ] }] };
  let current: any = template;
  const variables: Record<string, unknown>[] = [];
  const designer = {
    getTemplateData() { return current; },
    loadTemplateData(data: any) { current = data; return true; },
    async setVariables(data: Record<string, unknown>) { variables.push(data); },
    async getPreviewHtml() { throw new Error("label render failed"); },
  } as unknown as DesignerElement;
  const committed = outputJob(["old"]);
  await assert.rejects(() => renderPrintJobCandidate(
    designer, committed, outputJob(["new-1", "new-2"]),
  ), /label render failed/);
  assert.equal(current, template);
  assert.equal(variables.at(-1)?.客户, "old");
});

test("CT-BATCH-04: an incomplete rendered batch cannot open the print dialog", async () => {
  const calls: unknown[] = [];
  const restore = installPrintDomMock(calls);
  try {
    await assert.rejects(() => printRenderedPages({
      recordIds: ["rec-1", "rec-2"], pages: ["<div>ok</div>", ""], pageCounts: [1, 0],
      canvasWidth: 794, canvasHeight: 1123,
    }), { message: "打印页面生成失败" });
  } finally {
    restore();
  }
  assert.equal(calls.includes("documentPrint"), false);
});

test("CT-BATCH-04: cached pages must match the current job and include every engine page", () => {
  const job = outputJob(["rec-1", "rec-2"]);
  const complete = {
    recordIds: ["rec-1", "rec-2"],
    pages: ["<div><div>one</div></div>", "<div><div>two</div></div>"],
    pageCounts: [1, 1], canvasWidth: 794, canvasHeight: 1123,
  };
  assert.equal(isRenderedPrintJobCurrent(complete, job), true);
  assert.equal(isRenderedPrintJobCurrent({ ...complete, recordIds: ["rec-2", "rec-1"] }, job), false);
  assert.equal(isRenderedPrintJobCurrent({ ...complete, pages: complete.pages.slice(0, 1) }, job), false);
  assert.equal(isRenderedPrintJobCurrent({ ...complete, pageCounts: [1, 0] }, job), false);
  assert.equal(isRenderedPrintJobCurrent(null, job), false);
});

test("CT-BATCH-04: an engine document with two pages contributes two preview pages", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
  Object.defineProperty(globalThis, "DOMParser", { configurable: true, value: class {
    parseFromString(html: string) {
      return { body: { firstElementChild: { children: Array.from(
        { length: (html.match(/data-page=/g) ?? []).length }, () => ({}),
      ) } } };
    }
  } });
  const designer = {
    async setVariables() {},
    async getPreviewHtml() { return '<div><div data-page="1"></div><div data-page="2"></div></div>'; },
    getTemplateData() { return { canvasSize: { width: 400, height: 600 } }; },
  } as unknown as DesignerElement;
  try {
    const rendered = await renderPrintJobPages(designer, outputJob(["rec-1", "rec-2"]));
    assert.deepEqual(rendered.pageCounts, [2, 2]);
    assert.equal(renderedPreviewHeight(rendered), 2492);
  } finally {
    if (original) Object.defineProperty(globalThis, "DOMParser", original);
    else Reflect.deleteProperty(globalThis, "DOMParser");
  }
});

test("CT-BATCH-04: an empty engine page container rejects the candidate and restores the old record", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
  Object.defineProperty(globalThis, "DOMParser", { configurable: true, value: class {
    parseFromString() { return { body: { firstElementChild: { children: [] } } }; }
  } });
  const values: string[] = [];
  const designer = {
    async setVariables(data: Record<string, unknown>) { values.push(String(data.客户)); },
    async getPreviewHtml() { return "<div></div>"; },
  } as unknown as DesignerElement;
  try {
    await assert.rejects(() => renderPrintJobCandidate(
      designer, outputJob(["old"]), outputJob(["new"]),
    ), /没有实际分页/);
    assert.equal(values.at(-1), "old");
  } finally {
    if (original) Object.defineProperty(globalThis, "DOMParser", original);
    else Reflect.deleteProperty(globalThis, "DOMParser");
  }
});

test("CT-BATCH-05: failed candidate rendering restores the engine's editable template", async () => {
  const original = { pages: [{ id: "p", elements: [{ id: "text", type: "text", content: "fixed" }] }],
    canvasSize: { width: 794, height: 1123 } };
  let current = structuredClone(original);
  const designer = {
    getTemplateData() { return structuredClone(current); },
    loadTemplateData(value: typeof original) { current = structuredClone(value); return true; },
    async setVariables() {},
    async getPreviewHtml() { throw new Error("render failed"); },
  } as unknown as DesignerElement;
  await assert.rejects(() => renderPrintJobPages(designer, outputJob(["rec-1", "rec-2"])),
    { message: "render failed" });
  assert.deepEqual(current, original);
});

test("CT-BATCH-05: a failed candidate restores the committed record variables", async () => {
  const calls: string[] = [];
  const designer = {
    async setVariables(values: Record<string, unknown>) { calls.push(String(values.客户)); },
    async getPreviewHtml() { throw new Error("render failed"); },
  } as unknown as DesignerElement;
  await assert.rejects(() => renderPrintJobCandidate(
    designer, outputJob(["old"]), outputJob(["new-1", "new-2"]),
  ), { message: "render failed" });
  assert.equal(calls.at(-1), "old");
});

test("CT-BATCH-05: a candidate is ready only after its first record variables are restored", async () => {
  const calls: string[] = [];
  const designer = {
    async setVariables(values: Record<string, unknown>) { calls.push(String(values.客户)); },
    async getPreviewHtml() { return "<div><div>page</div></div>"; },
  } as unknown as DesignerElement;
  const rendered = await renderPrintJobCandidate(
    designer, outputJob(["old"]), outputJob(["new-1", "new-2"]),
  );
  assert.deepEqual(rendered.recordIds, ["new-1", "new-2"]);
  assert.equal(calls.at(-1), "new-1");
});

test("CT-BATCH-05: a failed candidate variable restore rolls back to the committed record", async () => {
  const calls: string[] = [];
  let candidateSets = 0;
  const designer = {
    async setVariables(values: Record<string, unknown>) {
      calls.push(String(values.客户));
      if (values.客户 === "new" && ++candidateSets === 2) throw new Error("candidate restore failed");
    },
    async getPreviewHtml() { return "<div><div>page</div></div>"; },
  } as unknown as DesignerElement;
  await assert.rejects(() => renderPrintJobCandidate(
    designer, outputJob(["old"]), outputJob(["new"]),
  ), { message: "candidate restore failed" });
  assert.equal(calls.at(-1), "old");
});

test("CT-BATCH-05: a superseded candidate must not restore variables into the new context", async () => {
  const calls: string[] = [];
  let current = true;
  const designer = {
    async setVariables(values: Record<string, unknown>) { calls.push(String(values.客户)); },
    async getPreviewHtml() {
      current = false;
      return "<div><div>page</div></div>";
    },
  } as unknown as DesignerElement;
  await assert.rejects(() => renderPrintJobCandidate(
    designer, outputJob(["old"]), outputJob(["new-1", "new-2"]), undefined, () => current,
  ), /已切换/);
  assert.deepEqual(calls, ["new-1"]);
});

test("CT-BATCH-05: restoring a batch record updates editable multi-field canvas values", async () => {
  let template: any;
  const testData: Record<string, unknown>[] = [];
  const variables: Record<string, unknown>[] = [];
  const designer = {
    loadTemplateData(value: unknown) { template = structuredClone(value); return true; },
    getTemplateData() { return structuredClone(template); },
    setAvailableVariables() {},
    async setTestData(value: Record<string, unknown>) { testData.push(value); },
    async setVariables(value: Record<string, unknown>) { variables.push(value); },
    async getPreviewHtml() { return "<div><div>page</div></div>"; },
  } as unknown as DesignerElement;
  const job: PrintJob = {
    source: { baseId: "base", tableId: "table", recordIds: ["rec-1", "rec-2"] },
    table: { name: "订单", fields: [
      { id: "order", name: "订单编号", type: "1" },
      { id: "customer", name: "客户", type: "1" },
    ] },
    documents: [
      { recordId: "rec-1", values: { 订单编号: "PO-0001", 客户: "甲公司" } },
      { recordId: "rec-2", values: { 订单编号: "PO-0002", 客户: "乙公司" } },
    ],
    generatedAt: "2026-09-26T10:00:00.000Z",
  };
  const token = (id: string) => `@${fieldDataSourceId(id)}`;
  await bindPrintJob(designer, {
    pages: [{ id: "p", elements: [{ id: "summary", type: "text",
      content: `订单：${token("order")}，客户：${token("customer")}` }] }],
    canvasSize: { width: 794, height: 1123 },
  }, job);

  const secondJob = { ...job, documents: [job.documents[1]], source: { ...job.source, recordIds: ["rec-2"] } };
  await restorePrintJobVariables(designer, secondJob);
  const key = "__duowei_render_summary";
  assert.equal(variables.at(-1)?.[key], "订单：PO-0002，客户：乙公司");
  assert.equal(testData.at(-1)?.[key], "订单：PO-0002，客户：乙公司");
  assert.equal((getPersistentTemplateData(designer).pages as any)[0].elements[0].content,
    `订单：${token("order")}，客户：${token("customer")}`);

  await renderPrintJobPages(designer, job);
  assert.equal(variables.at(-1)?.[key], "订单：PO-0001，客户：甲公司");
  assert.equal(testData.at(-1)?.[key], "订单：PO-0001，客户：甲公司");
});

test("SPEC-OUT-01: browser print rejects empty rendered output", async () => {
  const designer = {
    async setVariables() {},
    async getPreviewHtml() { return ""; },
  } as unknown as DesignerElement;
  const restorePrintDom = installPrintDomMock();

  await assert.rejects(() => printPrintJob(designer, outputJob(["rec-1"])), {
    message: "打印页面生成失败",
  });
  restorePrintDom();
});

test("SPEC-OUT-01: designer print event is intercepted before its own listener", () => {
  const target = new EventTarget();
  let delegated = 0;
  let upstream = 0;
  const stop = installDesignerPrintInterception(target, () => { delegated += 1; });
  target.addEventListener("designer:print", () => { upstream += 1; });
  target.dispatchEvent(new Event("designer:print"));
  assert.equal(delegated, 1);
  assert.equal(upstream, 0);
  stop();
  target.dispatchEvent(new Event("designer:print"));
  assert.equal(upstream, 1);
});

test("SPEC-UX-07: designer save and save-as delegate once to the host storage use case", () => {
  const target = new EventTarget();
  let saves = 0;
  let upstream = 0;
  const stop = installDesignerSaveInterception(target, () => { saves += 1; });
  target.addEventListener("designer:save", () => { upstream += 1; });
  target.dispatchEvent(new Event("designer:save"));
  target.dispatchEvent(new Event("designer:save-as"));
  assert.equal(saves, 2);
  assert.equal(upstream, 0);
  stop();
  target.dispatchEvent(new Event("designer:save"));
  assert.equal(upstream, 1);
});

test("SPEC-UX-03/07: locked designer header and panel selectors keep one component/save surface", () => {
  const bundle = readFileSync("node_modules/vue-print-designer/dist/web-component-zZPzxxzQ.js", "utf8");
  assert.match(bundle, /class: "h-14 bg-white border-b border-gray-200 grid/);
  assert.match(bundle, /__name: "HeaderElementsBar"/);
  assert.match(bundle, /dispatchDesignerEvent\("designer:toggle-template-panel"\)/);
  const appended: { textContent: string; remove(): void }[] = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement() {
      return { textContent: "", remove() {} };
    },
  } });
  const designer = { shadowRoot: { appendChild(style: any) { appended.push(style); } } } as unknown as DesignerElement;
  const target = new EventTarget();
  const closedPanels: string[] = [];
  for (const eventName of [
    "designer:close-elements-panel",
    "designer:close-properties-panel",
    "designer:close-structure-panel",
  ]) {
    target.addEventListener(eventName, () => closedPanels.push(eventName));
  }
  try {
    const stop = installDesignerWorkspaceChrome(designer, target);
    assert.match(appended[0].textContent, /header\.h-14\s*\{\s*display:\s*none/);
    assert.match(bundle, /templates: "模版列表"/);
    assert.match(bundle, /elements: "元素库"/);
    assert.match(appended[0].textContent, /button\[title="元素库"\]/);
    assert.match(appended[0].textContent, /button\[title="模版列表"\]/);
    assert.match(appended[0].textContent, /button\[title="导出 PDF"\]/);
    assert.match(appended[0].textContent, /button\[title\^="打印预览"\]/);
    assert.match(appended[0].textContent, /button\[title\^="主题:"\]/);
    assert.deepEqual(closedPanels, [
      "designer:close-elements-panel",
      "designer:close-properties-panel",
      "designer:close-structure-panel",
    ]);
    stop();
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("SPEC-UX-04: the host hides the designer template panel so the outer directory is the only template source", () => {
  const target = new EventTarget();
  let upstream = 0;
  target.addEventListener("designer:toggle-template-panel", () => { upstream += 1; });
  const stop = installDesignerTemplatePanelSuppression(target);
  assert.equal(upstream, 1);
  target.dispatchEvent(new Event("designer:toggle-template-panel"));
  assert.equal(upstream, 1);
  stop();
  target.dispatchEvent(new Event("designer:toggle-template-panel"));
  assert.equal(upstream, 2);
});

test("SPEC-OUT-01: a single record uses the real designer preview", async () => {
  const calls: Array<[string, unknown?]> = [];
  const designer = {
    async setVariables(data: unknown) { calls.push(["setVariables", data]); },
    async preview() { calls.push(["preview"]); return { opened: true }; },
    async getBatchPdfBlob() { calls.push(["getBatchPdfBlob"]); return new Blob(); },
  } as unknown as DesignerElement;

  const result = await previewPrintJob(designer, outputJob(["rec-1"]));
  assert.deepEqual(calls, [
    ["setVariables", expectedVariables("rec-1")],
    ["preview"],
  ]);
  assert.deepEqual(result, { kind: "designer", result: { opened: true } });
});

test("SPEC-LINK-03: an empty link binds an explicit empty state without a fake detail row", async () => {
  const calls: Record<string, unknown>[] = [];
  const designer = {
    loadTemplateData() { return true; },
    async setTestData(data: Record<string, unknown>) { calls.push(data); },
    async setVariables(data: Record<string, unknown>) { calls.push(data); },
  } as unknown as DesignerElement;
  const job = outputJob(["rec-1"]);
  job.table.fields.push({ id: "lines", name: "明细", type: "18", isLink: true });
  job.documents[0].values.明细 = [];

  await bindPrintJob(designer, null, job);
  assert.deepEqual(calls[0].明细, []);
  assert.equal(calls[0].__duowei_print_empty_lines, "暂无关联记录");

  job.documents[0].values.明细 = [{ 产品: "纸" }];
  await bindPrintJob(designer, null, job);
  assert.equal(calls[2].__duowei_print_empty_lines, "");
});

test("SPEC-BATCH-02: a batch preview is generated as one PDF blob", async () => {
  const calls: Array<[string, unknown, unknown?]> = [];
  const pdf = new Blob(["one-batch"], { type: "application/pdf" });
  const designer = {
    async preview() { calls.push(["preview", null]); },
    async getBatchPdfBlob(items: unknown, request: unknown) {
      calls.push(["getBatchPdfBlob", items, request]);
      return pdf;
    },
  } as unknown as DesignerElement;

  const result = await previewPrintJob(designer, outputJob(["rec-1", "rec-2"]));
  assert.deepEqual(calls, [["getBatchPdfBlob", [
    { variables: expectedVariables("rec-1") },
    { variables: expectedVariables("rec-2") },
  ], { filename: "duowei-print-preview.pdf" }]]);
  assert.equal(result.kind, "pdf");
  if (result.kind === "pdf") assert.equal(result.blob, pdf);
});

test("SPEC-BATCH-02: an empty batch preview result is rejected", async () => {
  const designer = {
    async getBatchPdfBlob() { return null; },
  } as unknown as DesignerElement;
  await assert.rejects(
    () => previewPrintJob(designer, outputJob(["rec-1", "rec-2"])),
    { message: "批量预览 PDF 生成失败" },
  );
});

test("SPEC-CTX-02: output rejects an empty print job", async () => {
  const designer = {} as DesignerElement;
  await assert.rejects(() => printPrintJob(designer, outputJob([])), {
    message: "打印任务没有可输出的记录",
  });
});

function installPrintDomMock(calls: unknown[] = []) {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const node = () => ({
    innerHTML: "",
    className: "",
    textContent: "",
    remove() { calls.push("removePrintRoot"); },
    querySelectorAll() { return []; },
  });
  const documentMock = {
    createElement(tag: string) {
      if (tag === "div") calls.push("createPrintRoot");
      return node();
    },
    body: {
      appendChild() { calls.push("appendPrintRoot"); },
    },
  };
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentMock });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    print() { calls.push("documentPrint"); },
    addEventListener() {},
    removeEventListener() {},
  } });
  return () => {
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  };
}
