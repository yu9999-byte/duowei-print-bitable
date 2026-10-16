import "vue-print-designer";
import "vue-print-designer/style.css";
import { prepareContinuousLayout } from "../../src/core/continuous-layout.ts";
import { generateContinuousTemplate } from "../../src/core/template-generator.ts";
import { bindPrintJob, composeBrowserPrintDocument, getPersistentTemplateData,
  renderPrintJobPages, composeRenderedPrintPages, type DesignerElement } from "../../src/engine/designer-adapter.ts";
import type { PrintJob } from "../../src/core/print-job.ts";

const button = document.querySelector<HTMLButtonElement>("#run")!;
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
      values: { 订单编号: `PO-${String(index + 1).padStart(4, "0")}`, 客户: `客户${index + 1}` },
    })),
    generatedAt: "2026-09-30T10:00:00.000Z",
  };
}

async function savePdf(blob: Blob, count: number) {
  const response = await fetch(`/__test/pdf?count=${count}`, { method: "POST", body: blob });
  if (!response.ok) throw new Error(`Local PDF save failed: ${response.status}`);
}

async function savePrintHtml(html: string, count: number) {
  const response = await fetch(`/__test/html?count=${count}`, { method: "POST",
    headers: { "content-type": "text/html; charset=utf-8" }, body: html });
  if (!response.ok) throw new Error(`Local print HTML save failed: ${response.status}`);
}

async function runCase(count: number) {
  const job = createJob(count);
  const template = generateContinuousTemplate(job);
  template.canvasSize.height = 1123;
  await bindPrintJob(designer, template, job);
  const original = getPersistentTemplateData(designer);
  const prepared = prepareContinuousLayout(original, job);
  if (!designer.loadTemplateData(prepared.template)) throw new Error("Continuous template load failed");
  try {
    await designer.setVariables(prepared.variables);
    const html = await designer.getPreviewHtml();
    const root = new DOMParser().parseFromString(html, "text/html").body.firstElementChild;
    const pages = Array.from(root?.children ?? [])
      .filter((node) => !["STYLE", "LINK", "SCRIPT"].includes(node.tagName));
    const allText = pages.map((page) => page.textContent ?? "").join("\n");
    const occurrences = job.documents.map((document) => {
      const order = String(document.values.订单编号);
      return allText.split(order).length - 1;
    });
    if (pages.length !== 1 || !occurrences.every((n) => n === 1)) throw new Error("Missing, repeated, or paginated records");
    const blob = await designer.export({ type: "pdfBlob" });
    if (!(blob instanceof Blob) || blob.type !== "application/pdf") throw new Error("Native PDF blob missing");
    await savePdf(blob, count);
    const rendered = {
      layout: "continuous" as const,
      recordIds: job.source.recordIds,
      pages: [html],
      pageCounts: [1],
      canvasWidth: prepared.canvasWidth,
      canvasHeight: prepared.canvasHeight,
    };
    await savePrintHtml(`<!doctype html><html><head><meta charset="utf-8"></head>`
      + `<body><div id="duowei-print-root">${composeBrowserPrintDocument(rendered)}</div></body></html>`, count);
    return {
      count,
      expectedHeight: prepared.canvasHeight,
      pageCount: pages.length,
      pageSizes: pages.map((page) => ({
        width: (page as HTMLElement).style.width,
        height: (page as HTMLElement).style.height,
        scrollWidth: (page as HTMLElement).scrollWidth,
        scrollHeight: (page as HTMLElement).scrollHeight,
      })),
      valuesOnce: occurrences.every((value) => value === 1),
      firstOccurrences: occurrences.slice(0, 8),
      lastOccurrences: occurrences.slice(-3),
      pdfSize: blob.size,
    };
  } finally {
    if (!designer.loadTemplateData(original)) throw new Error("Continuous template restore failed");
  }
}

button.addEventListener("click", async () => {
  button.disabled = true;
  result.textContent = "Running";
  try {
    await customElements.whenDefined("print-designer");
    if (!designer.isReady) {
      await new Promise<void>((resolve) => designer.addEventListener("ready", () => resolve(), { once: true }));
    }
    const cases = [];
    for (const count of [2, 3, 10, 50]) {
      try {
        cases.push({ ok: true, ...(await runCase(count)) });
      } catch (cause) {
        cases.push({ ok: false, count, error: cause instanceof Error ? cause.message : String(cause) });
      }
    }
    result.textContent = JSON.stringify({ passed: cases.every((item) => item.ok), cases });
  } catch (cause) {
    result.textContent = JSON.stringify({ passed: false,
      error: cause instanceof Error ? cause.message : String(cause) });
  } finally {
    button.disabled = false;
  }
});


const preview = document.createElement("iframe");
preview.title = "连续与默认对照";
preview.style.cssText = "width:830px;height:800px;display:block";
document.body.append(preview);
const summary = document.createElement("p");
summary.id = "comparison-summary";
document.body.insertBefore(summary, preview);
async function compare(mode: "default" | "continuous") {
  const job = createJob(2);
  const template = generateContinuousTemplate(job);
  template.canvasSize.height = 1123;
  if (mode === "default") delete template.ext.batchLayout;
  await bindPrintJob(designer, template, job);
  const rendered = await renderPrintJobPages(designer, job);
  preview.srcdoc = composeRenderedPrintPages(rendered);
  summary.textContent = `${mode}: ${rendered.pages.length} 页，高度 ${rendered.canvasHeight}px`;
}
for (const mode of ["default", "continuous"] as const) {
  const control = document.createElement("button");
  control.textContent = mode === "default" ? "验证默认" : "验证连续";
  control.addEventListener("click", () => compare(mode));
  document.body.insertBefore(control, preview);
}
button.click();
