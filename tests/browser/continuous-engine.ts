import "vue-print-designer";
import "vue-print-designer/style.css";
import { prepareContinuousLayout } from "../../src/core/continuous-layout.ts";
import { generateContinuousTemplate } from "../../src/core/template-generator.ts";
import { bindPrintJob, composeRenderedPrintPages, getPersistentTemplateData,
  type DesignerElement } from "../../src/engine/designer-adapter.ts";
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
  await bindPrintJob(designer, generateContinuousTemplate(job), job);
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
    await savePrintHtml(`<!doctype html><html><head><meta charset="utf-8"><style>
      @page{size:${prepared.canvasWidth}px ${prepared.canvasHeight}px;margin:0}
      html,body{margin:0;padding:0}
      [data-duowei-print-page="true"]{break-after:page;margin:0!important}
      [data-duowei-print-page-last="true"]{break-after:auto}
    </style></head><body><div id="duowei-print-root">${composeRenderedPrintPages(rendered)}</div></body></html>`, count);
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
    for (const count of [7, 50]) {
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
