import "vue-print-designer";
import "vue-print-designer/style.css";
import { generateTemplate } from "../../src/core/template-generator.ts";
import { bindPrintJob, composeBrowserPrintDocument, composeRenderedPrintPages, getPrintJobPdfBlob,
  renderPrintJobPages,
  type DesignerElement } from "../../src/engine/designer-adapter.ts";
import type { PrintJob } from "../../src/core/print-job.ts";

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
      values: {
        订单编号: `PO-${String(index + 1).padStart(4, "0")}`,
        客户: `客户${index + 1}`,
      },
    })),
    generatedAt: "2026-10-03T10:00:00.000Z",
  };
}

async function runCase(count: number) {
  const job = createJob(count);
  await bindPrintJob(designer, generateTemplate(job), job);
  const renderStartedAt = performance.now();
  const rendered = await renderPrintJobPages(designer, job);
  const renderMs = Math.round((performance.now() - renderStartedAt) * 10) / 10;
  const pages = composeRenderedPrintPages(rendered);
  const parsedDocument = new DOMParser().parseFromString(pages, "text/html");
  const printed = Array.from(parsedDocument.querySelectorAll('[data-duowei-print-page="true"]'));
  const valuesOnce = job.documents.every((item, index) => {
    const order = String(item.values.订单编号);
    return printed[index]?.textContent?.includes(order)
      && printed.filter((page) => page.textContent?.includes(order)).length === 1;
  });
  if (rendered.pageCounts.length !== count
    || rendered.pageCounts.some((pageCount) => pageCount !== 1)
    || printed.length !== count
    || !valuesOnce) {
    throw new Error(`Unexpected rendered pages for ${count}: ${rendered.pageCounts.join(",")}/${printed.length}`);
  }

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head>`
    + `<body><div id="duowei-print-root">${composeBrowserPrintDocument(rendered)}</div></body></html>`;
  const response = await fetch(`/__test/html?count=${count}`, { method: "POST",
    headers: { "content-type": "text/html; charset=utf-8" }, body: html });
  if (!response.ok) throw new Error(`Local print HTML save failed: ${response.status}`);
  const pdfStartedAt = performance.now();
  const blob = await getPrintJobPdfBlob(designer, job, `default-${count}.pdf`);
  const pdfMs = Math.round((performance.now() - pdfStartedAt) * 10) / 10;
  const pdfResponse = await fetch(`/__test/pdf?count=${count}`, { method: "POST", body: blob });
  if (!pdfResponse.ok) throw new Error(`Local PDF save failed: ${pdfResponse.status}`);
  return { count, pageCounts: rendered.pageCounts, pageCount: printed.length,
    width: rendered.canvasWidth, height: rendered.canvasHeight, valuesOnce,
    renderMs, pdfMs, pdfSize: blob.size };
}

async function run() {
  await customElements.whenDefined("print-designer");
  if (!designer.isReady) {
    await new Promise<void>((resolve) => designer.addEventListener("ready", () => resolve(), { once: true }));
  }
  const cases = [];
  for (const count of [1, 3, 10, 50]) cases.push(await runCase(count));
  return { cases };
}

run().then((value) => { result.textContent = JSON.stringify({ passed: true, ...value }); },
  (cause) => { result.textContent = JSON.stringify({ passed: false,
    error: cause instanceof Error ? cause.message : String(cause) }); });
