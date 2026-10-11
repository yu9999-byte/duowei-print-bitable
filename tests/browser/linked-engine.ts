import "vue-print-designer";
import "vue-print-designer/style.css";
import { generateTemplate } from "../../src/core/template-generator.ts";
import {
  bindPrintJob,
  composeBrowserPrintDocument,
  composeRenderedPrintPages,
  getPrintJobPdfBlob,
  renderPrintJobPages,
  type DesignerElement,
} from "../../src/engine/designer-adapter.ts";
import type { PrintJob } from "../../src/core/print-job.ts";

const result = document.querySelector<HTMLOutputElement>("#result")!;
const designer = document.querySelector<DesignerElement>("print-designer")!;

function detailRows(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    行号: `${prefix}-${String(index + 1).padStart(3, "0")}`,
    商品: `商品 ${index + 1}`,
    数量: String((index % 9) + 1),
    备注: `关联明细 ${prefix} 第 ${index + 1} 行，用于验证原生表格分页。`,
  }));
}

function createJob(details: Array<{ recordId: string; order: string; rows: ReturnType<typeof detailRows> }>): PrintJob {
  return {
    source: {
      baseId: "linked-browser-test",
      tableId: "orders",
      recordIds: details.map((detail) => detail.recordId),
    },
    table: {
      name: "关联订单",
      fields: [
        { id: "order", name: "订单编号", type: "1", isPrimary: true },
        {
          id: "lines",
          name: "订单明细",
          type: "18",
          isLink: true,
          arrayColumns: [
            { field: "行号", header: "行号" },
            { field: "商品", header: "商品" },
            { field: "数量", header: "数量" },
            { field: "备注", header: "备注" },
          ],
        },
      ],
    },
    documents: details.map((detail) => ({
      recordId: detail.recordId,
      values: { 订单编号: detail.order, 订单明细: detail.rows },
    })),
    generatedAt: "2026-10-10T08:00:00.000Z",
  };
}

function printedPages(rendered: Awaited<ReturnType<typeof renderPrintJobPages>>) {
  const parsed = new DOMParser().parseFromString(composeRenderedPrintPages(rendered), "text/html");
  return Array.from(parsed.querySelectorAll<HTMLElement>('[data-duowei-print-page="true"]'));
}

function countText(pages: HTMLElement[], value: string) {
  return pages.reduce((total, page) => total + (page.textContent?.split(value).length ?? 1) - 1, 0);
}

function assertRowsExactlyOnce(pages: HTMLElement[], rows: ReturnType<typeof detailRows>) {
  for (const row of rows) {
    if (countText(pages, row.行号) !== 1) {
      throw new Error(`关联明细行未恰好出现一次：${row.行号}`);
    }
  }
}

async function saveArtifact(name: string, kind: "html" | "pdf", body: string | Blob) {
  const response = await fetch(`/__test/artifact?name=${encodeURIComponent(name)}&kind=${kind}`, {
    method: "POST",
    headers: typeof body === "string" ? { "content-type": "text/html; charset=utf-8" } : undefined,
    body,
  });
  if (!response.ok) throw new Error(`关联明细验收产物保存失败：${name}/${response.status}`);
}

async function render(job: PrintJob) {
  await bindPrintJob(designer, generateTemplate(job), job);
  return renderPrintJobPages(designer, job);
}

async function runEmptyCase() {
  const job = createJob([{ recordId: "empty", order: "EMPTY-001", rows: [] }]);
  const rendered = await render(job);
  const pages = printedPages(rendered);
  if (pages.length !== 1 || countText(pages, "暂无关联记录") !== 1 || countText(pages, "EMPTY-") !== 1) {
    throw new Error("空关联没有生成明确且唯一的空状态页面");
  }
  return { pageCounts: rendered.pageCounts, pages: pages.length };
}

async function runSingleRowCase() {
  const rows = detailRows("ONE", 1);
  const job = createJob([{ recordId: "one", order: "ONE-ORDER", rows }]);
  const rendered = await render(job);
  const pages = printedPages(rendered);
  assertRowsExactlyOnce(pages, rows);
  if (countText(pages, "暂无关联记录") !== 0) throw new Error("单条关联错误显示为空状态");
  return { pageCounts: rendered.pageCounts, pages: pages.length };
}

async function runLongCase() {
  const rows = detailRows("LONG", 96);
  const job = createJob([{ recordId: "long", order: "LONG-ORDER", rows }]);
  const rendered = await render(job);
  const pages = printedPages(rendered);
  if (pages.length < 3 || rendered.pageCounts[0] !== pages.length) {
    throw new Error(`长明细未跨至少三页：${rendered.pageCounts.join(",")}/${pages.length}`);
  }
  if (pages.some((page) => !page.textContent?.includes("行号") || !page.textContent?.includes("备注"))) {
    throw new Error("关联明细续页没有重复相同表头");
  }
  assertRowsExactlyOnce(pages, rows);
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head>`
    + `<body><div id="duowei-print-root">${composeBrowserPrintDocument(rendered)}</div></body></html>`;
  const pdf = await getPrintJobPdfBlob(designer, job, "linked-long.pdf");
  if (pdf.size < 1_000) throw new Error("长明细 PDF 为空");
  await saveArtifact("linked-long", "html", html);
  await saveArtifact("linked-long", "pdf", pdf);
  return { pageCounts: rendered.pageCounts, pages: pages.length, rows: rows.length, pdfSize: pdf.size };
}

async function runBatchCase() {
  const firstRows = detailRows("A", 72);
  const secondRows = detailRows("B", 72);
  const job = createJob([
    { recordId: "order-a", order: "ORDER-A", rows: firstRows },
    { recordId: "order-b", order: "ORDER-B", rows: secondRows },
  ]);
  const rendered = await render(job);
  const pages = printedPages(rendered);
  assertRowsExactlyOnce(pages, firstRows);
  assertRowsExactlyOnce(pages, secondRows);
  if (rendered.pageCounts.some((count) => count < 2)) {
    throw new Error(`批量关联明细没有分别跨页：${rendered.pageCounts.join(",")}`);
  }
  const firstBPage = pages.findIndex((page) => page.textContent?.includes("B-001"));
  if (firstBPage !== rendered.pageCounts[0]) {
    throw new Error(`第二条主记录没有从自己的文档边界开始：${firstBPage}/${rendered.pageCounts[0]}`);
  }
  if (pages.slice(0, firstBPage).some((page) => page.textContent?.includes("B-"))
    || pages.slice(firstBPage).some((page) => page.textContent?.includes("A-"))) {
    throw new Error("两个主记录的关联明细发生串行");
  }
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head>`
    + `<body><div id="duowei-print-root">${composeBrowserPrintDocument(rendered)}</div></body></html>`;
  const pdf = await getPrintJobPdfBlob(designer, job, "linked-batch.pdf");
  if (pdf.size < 1_000) throw new Error("批量关联明细 PDF 为空");
  await saveArtifact("linked-batch", "html", html);
  await saveArtifact("linked-batch", "pdf", pdf);
  return { pageCounts: rendered.pageCounts, pages: pages.length, rows: firstRows.length + secondRows.length, pdfSize: pdf.size };
}

async function run() {
  await customElements.whenDefined("print-designer");
  if (!designer.isReady) {
    await new Promise<void>((resolve) => designer.addEventListener("ready", () => resolve(), { once: true }));
  }
  return {
    empty: await runEmptyCase(),
    one: await runSingleRowCase(),
    long: await runLongCase(),
    batch: await runBatchCase(),
  };
}

run().then(
  (value) => { result.textContent = JSON.stringify({ passed: true, ...value }); },
  (cause) => { result.textContent = JSON.stringify({ passed: false, error: cause instanceof Error ? cause.message : String(cause) }); },
);
