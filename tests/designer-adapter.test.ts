import assert from "node:assert/strict";
import test from "node:test";
import {
  bindPrintJob,
  exportPrintJob,
  getPrintPreviewHtml,
  previewPrintJob,
  printPrintJob,
  installDesignerPrintInterception,
  installDesignerTemplatePanelSuppression,
  renameDataSourceCopy,
  type DesignerElement,
} from "../src/engine/designer-adapter.ts";
import type { PrintJob } from "../src/core/print-job.ts";
import { SYSTEM_PRINT_DATE_ID } from "../src/core/data-sources.ts";

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
      children: [{ id: "客户", label: "客户" }],
    },
    {
      id: "__duowei_system",
      label: "系统",
      children: [{ id: SYSTEM_PRINT_DATE_ID, label: "打印日期" }],
    },
  ]);
  assert.deepEqual(payloads, [
    { 客户: "甲", [SYSTEM_PRINT_DATE_ID]: "2026-09-21", 打印日期: "2026-09-21" },
    { 客户: "甲", [SYSTEM_PRINT_DATE_ID]: "2026-09-21", 打印日期: "2026-09-21" },
  ]);
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
    [SYSTEM_PRINT_DATE_ID]: "2026-09-21",
    打印日期: "2026-09-21",
  };
}

test("SPEC-SRC-02: designer terminology calls the variable catalog data sources", () => {
  assert.equal(renameDataSourceCopy("可用变量"), "数据源");
  assert.equal(renameDataSourceCopy(" Available Variables "), " Data Sources ");
  assert.equal(renameDataSourceCopy("变量"), "变量");
});

test("SPEC-OUT-01/02: a single document uses rendered HTML and PDF export APIs", async () => {
  const calls: Array<[string, unknown]> = [];
  const designer = {
    async setVariables(data: unknown) { calls.push(["setVariables", data]); },
    async getPreviewHtml() { calls.push(["getPreviewHtml", null]); return "<div><div>single</div></div>"; },
    async export(request: unknown) { calls.push(["export", request]); },
    async printBatch() { calls.push(["printBatch", null]); },
    async exportBatchPdf() { calls.push(["exportBatchPdf", null]); },
  } as unknown as DesignerElement;
  const job = outputJob(["rec-1"]);

  const restorePrintDom = installPrintDomMock();
  await printPrintJob(designer, job);
  await exportPrintJob(designer, job, "single.pdf");
  restorePrintDom();

  assert.deepEqual(calls, [
    ["setVariables", expectedVariables("rec-1")],
    ["getPreviewHtml", null],
    ["setVariables", expectedVariables("rec-1")],
    ["export", { type: "pdf", filename: "single.pdf" }],
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

test("SPEC-BATCH-02: multiple documents render in order for one print and one batch PDF export", async () => {
  const calls: Array<[string, unknown, unknown?]> = [];
  const designer = {
    async export() { calls.push(["export", null]); },
    async setVariables(data: unknown) { calls.push(["setVariables", data]); },
    async getPreviewHtml() { calls.push(["getPreviewHtml", null]); return "<div><div>page</div></div>"; },
    async printBatch(items: unknown, request: unknown) { calls.push(["printBatch", items, request]); },
    async exportBatchPdf(items: unknown, request: unknown) { calls.push(["exportBatchPdf", items, request]); },
  } as unknown as DesignerElement;
  const job = outputJob(["rec-1", "rec-2", "rec-3"]);

  const restorePrintDom = installPrintDomMock();
  await printPrintJob(designer, job);
  await exportPrintJob(designer, job, "batch.pdf");
  restorePrintDom();

  const expectedItems = [
    { variables: expectedVariables("rec-1") },
    { variables: expectedVariables("rec-2") },
    { variables: expectedVariables("rec-3") },
  ];
  assert.deepEqual(calls, [
    ...expectedItems.flatMap(({ variables }) => [["setVariables", variables], ["getPreviewHtml", null]]),
    ["setVariables", expectedVariables("rec-1")],
    ["exportBatchPdf", expectedItems, { filename: "batch.pdf" }],
  ]);
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
