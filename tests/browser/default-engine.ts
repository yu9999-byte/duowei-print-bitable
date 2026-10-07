import "vue-print-designer";
import "vue-print-designer/style.css";
import { generateTemplate } from "../../src/core/template-generator.ts";
import { bindPrintJob, composeRenderedPrintPages, renderPrintJobPages,
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
  const rendered = await renderPrintJobPages(designer, job);
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

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{margin:0;padding:0}body{min-width:320px}
    @page{size:${rendered.canvasWidth}px ${rendered.canvasHeight}px;margin:0}
    #duowei-print-root{display:none}
    @media print{
      body > *{display:none!important}body > #duowei-print-root{display:block!important}
      #duowei-print-root,#duowei-print-root *{visibility:visible}
      [data-duowei-print-page="true"]{break-after:page;margin:0!important}
      [data-duowei-print-page="true"] > :first-child{margin:0!important}
      [data-duowei-print-page-last="true"]{break-after:auto}
    }
  </style></head><body><div id="duowei-print-root">${pages}</div></body></html>`;
  const response = await fetch(`/__test/html?count=${count}`, { method: "POST",
    headers: { "content-type": "text/html; charset=utf-8" }, body: html });
  if (!response.ok) throw new Error(`Local print HTML save failed: ${response.status}`);
  return { count, pageCounts: rendered.pageCounts, pageCount: printed.length,
    width: rendered.canvasWidth, height: rendered.canvasHeight, valuesOnce };
}

async function run() {
  await customElements.whenDefined("print-designer");
  if (!designer.isReady) {
    await new Promise<void>((resolve) => designer.addEventListener("ready", () => resolve(), { once: true }));
  }
  const cases = [];
  for (const count of [3, 50]) cases.push(await runCase(count));
  return { cases };
}

run().then((value) => { result.textContent = JSON.stringify({ passed: true, ...value }); },
  (cause) => { result.textContent = JSON.stringify({ passed: false,
    error: cause instanceof Error ? cause.message : String(cause) }); });
