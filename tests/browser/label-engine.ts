import "vue-print-designer";
import "vue-print-designer/style.css";
import { generateLabelTemplate } from "../../src/core/template-generator.ts";
import { bindPrintJob, composeBrowserPrintDocument, getPersistentTemplateData, renderPrintJobPages,
  type DesignerElement } from "../../src/engine/designer-adapter.ts";
import type { PrintJob } from "../../src/core/print-job.ts";

const button = document.querySelector<HTMLButtonElement>("#run")!;
const download = document.querySelector<HTMLButtonElement>("#download")!;
const result = document.querySelector<HTMLOutputElement>("#result")!;
const designer = document.querySelector<DesignerElement>("print-designer")!;

function createJob(count: number): PrintJob {
  return {
    source: { baseId: "browser-test", tableId: "orders",
      recordIds: Array.from({ length: count }, (_, index) => `rec-${index + 1}`) },
    table: { name: "订单", fields: [
      { id: "order", name: "订单编号", type: "1", isPrimary: true },
      { id: "customer", name: "客户", type: "1" },
    ] },
    documents: Array.from({ length: count }, (_, index) => ({
      recordId: `rec-${index + 1}`,
      values: { 订单编号: `PO-${index + 1}`, 客户: `客户${index + 1}` },
    })),
    generatedAt: "2026-09-30T10:00:00.000Z",
  };
}

async function saveArtifact(kind: "pdf" | "html", count: number, body: Blob | string) {
  const response = await fetch(`/__test/${kind}?count=${count}`, {
    method: "POST",
    headers: typeof body === "string" ? { "content-type": "text/html; charset=utf-8" } : undefined,
    body,
  });
  if (!response.ok) throw new Error(`Local ${kind.toUpperCase()} save failed: ${response.status}`);
}

async function runCase(count: number) {
  const job = createJob(count);
  await bindPrintJob(designer, generateLabelTemplate(job), job);
  const original = JSON.stringify(getPersistentTemplateData(designer));
  const rendered = await renderPrintJobPages(designer, job);
  const page = new DOMParser().parseFromString(rendered.pages[0], "text/html").body.firstElementChild;
  const pageTexts = Array.from(page?.children ?? [])
    .filter((node) => !["STYLE", "LINK", "SCRIPT"].includes(node.tagName))
    .map((node) => node.textContent ?? "");
  const occurrences = job.documents.map((document) => {
    const order = String(document.values.订单编号);
    const customer = String(document.values.客户);
    return {
      order: pageTexts.reduce((n, text) => n + text.split(order).length - 1, 0),
      customer: pageTexts.reduce((n, text) => n + text.split(customer).length - 1, 0),
      page: pageTexts.findIndex((text) => text.includes(order)) + 1,
    };
  });
  const restored = JSON.stringify(getPersistentTemplateData(designer)) === original;
  const prepared = (await import("../../src/core/label-layout.ts")).prepareLabelLayout(
    getPersistentTemplateData(designer), job);
  if (!designer.loadTemplateData(prepared.template)) throw new Error("PDF template load failed");
  let blob: Blob;
  try {
    await designer.setVariables(prepared.variables);
    const output = await designer.export({ type: "pdfBlob" });
    if (!(output instanceof Blob) || output.type !== "application/pdf") throw new Error("Native PDF blob missing");
    blob = output;
  } finally {
    if (!designer.loadTemplateData(JSON.parse(original))) throw new Error("PDF template restore failed");
  }
  await saveArtifact("pdf", count, blob);
  await saveArtifact("html", count, `<!doctype html><html><head><meta charset="utf-8"></head>`
    + `<body><div id="duowei-print-root">${composeBrowserPrintDocument(rendered)}</div></body></html>`);
  const expectedPages = Math.ceil(count / 6);
  const passed = rendered.layout === "labels" && rendered.pageCounts[0] === expectedPages
    && pageTexts.length === expectedPages && restored && blob.size > 1000
    && occurrences.every((item, index) => item.order === 1 && item.customer === 1
      && item.page === Math.floor(index / 6) + 1);
  return { count, passed, pageCounts: rendered.pageCounts, occurrences, restored, pdfSize: blob.size,
    pageText: pageTexts.map((text) => text.slice(0, 230)) };
}

button.addEventListener("click", async () => {
  button.disabled = true;
  download.disabled = true;
  result.textContent = "Running";
  try {
    await customElements.whenDefined("print-designer");
    if (!designer.isReady) {
      await new Promise<void>((resolve) => designer.addEventListener("ready", () => resolve(), { once: true }));
    }
    const cases = [];
    for (const count of [3, 7]) cases.push(await runCase(count));
    result.textContent = JSON.stringify({ passed: cases.every((item) => item.passed), cases });
  } catch (cause) {
    result.textContent = JSON.stringify({ passed: false,
      error: cause instanceof Error ? cause.message : String(cause) });
  } finally {
    button.disabled = false;
  }
});

button.click();
