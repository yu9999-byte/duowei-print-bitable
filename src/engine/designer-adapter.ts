import type { PrintJob } from "../core/print-job.ts";
import { generateTemplate } from "../core/template-generator.ts";
import {
  buildDataSourceCatalog,
  refreshTemplateDataSources,
  SYSTEM_PRINT_DATE_ID,
  type DesignerDataSourceGroup,
} from "../core/data-sources.ts";

export type DesignerElement = HTMLElement & {
  isReady?: boolean;
  loadTemplateData(data: unknown): boolean;
  setTestData(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<void>;
  setVariables(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<void>;
  setAvailableVariables?(variables: DesignerDataSourceGroup[]): void;
  getTemplateData(): unknown;
  print(request?: { mode?: "browser" | "local" | "remote" }): Promise<unknown>;
  export(request: { type: "pdf" | "pdfBlob"; filename?: string }): Promise<unknown>;
  getPreviewHtml(): Promise<string>;
  preview(request?: Record<string, unknown>): Promise<unknown>;
  getBatchPdfBlob(
    items: Array<{ variables?: Record<string, unknown> }>,
    request?: { filename?: string },
  ): Promise<Blob | null>;
  printBatch(items: Array<{ variables?: Record<string, unknown> }>, request?: { mode?: "browser" | "local" | "remote" }): Promise<unknown>;
  exportBatchPdf(items: Array<{ variables?: Record<string, unknown> }>, request?: { filename?: string }): Promise<unknown>;
};

export function getDesigner(element: Element | null): DesignerElement {
  if (!(element instanceof HTMLElement) || element.tagName.toLowerCase() !== "print-designer") {
    throw new Error("真实打印设计器尚未挂载");
  }
  return element as DesignerElement;
}

export async function bindPrintJob(designer: DesignerElement, template: unknown, job: PrintJob) {
  const resolvedTemplate = refreshTemplateDataSources(
    template ?? generateTemplate(job),
    job.table.fields,
  );
  if (!designer.loadTemplateData(resolvedTemplate)) throw new Error("打印模板无法加载");
  designer.setAvailableVariables?.(buildDataSourceCatalog(job.table.fields));
  const data = getDocumentVariables(job, 0);
  await designer.setTestData(data);
  await designer.setVariables(data);
}

function getDocumentVariables(job: PrintJob, index: number): Record<string, unknown> {
  const values = job.documents[index]?.values ?? {};
  const printDate = job.generatedAt.slice(0, 10);
  const emptyLinks = Object.fromEntries(job.table.fields
    .filter((field) => field.isLink)
    .map((field) => {
      const rows = values[field.name];
      return [
        "__duowei_print_empty_" + field.id,
        Array.isArray(rows) && rows.length > 0 ? "" : "暂无关联记录",
      ];
    }));
  const data: Record<string, unknown> = {
    ...values,
    ...emptyLinks,
    [SYSTEM_PRINT_DATE_ID]: printDate,
  };
  // Compatibility for templates saved before system data sources were namespaced.
  if (!("打印日期" in values)) data.打印日期 = printDate;
  return data;
}

const DATA_SOURCE_COPY: Record<string, string> = {
  可用变量: "数据源",
  "Available Variables": "Data Sources",
};

export function renameDataSourceCopy(value: string): string {
  const visibleText = value.trim();
  const replacement = DATA_SOURCE_COPY[visibleText];
  return replacement ? value.replace(visibleText, replacement) : value;
}

export function installDataSourceTerminology(designer: DesignerElement): () => void {
  const root = designer.shadowRoot;
  if (!root || typeof document === "undefined" || typeof MutationObserver === "undefined") {
    return () => undefined;
  }
  const syncCopy = () => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const nextValue = renameDataSourceCopy(node.textContent ?? "");
      if (nextValue !== node.textContent) node.textContent = nextValue;
      node = walker.nextNode();
    }
  };
  syncCopy();
  const observer = new MutationObserver(syncCopy);
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  return () => observer.disconnect();
}

export function installDesignerPrintInterception(
  target: EventTarget,
  print: () => void,
): () => void {
  const handlePrint = (event: Event) => {
    event.stopImmediatePropagation();
    print();
  };
  // Registered before the asynchronous designer bundle mounts its window listener.
  target.addEventListener("designer:print", handlePrint, { capture: true });
  return () => target.removeEventListener("designer:print", handlePrint, { capture: true });
}

export function installDesignerTemplatePanelSuppression(
  target: EventTarget,
): () => void {
  // The engine opens this panel by default. The host owns the template directory,
  // so close it once and block the toolbar toggle from creating a second source.
  target.dispatchEvent(new Event("designer:toggle-template-panel"));
  const ownDescriptor = Object.getOwnPropertyDescriptor(target, "dispatchEvent");
  const originalDispatchEvent = target.dispatchEvent;
  const suppressedDispatchEvent = function (this: EventTarget, event: Event): boolean {
    if (event.type === "designer:toggle-template-panel") return false;
    return originalDispatchEvent.call(this, event);
  };
  Object.defineProperty(target, "dispatchEvent", {
    configurable: true,
    writable: true,
    value: suppressedDispatchEvent,
  });
  return () => {
    if (target.dispatchEvent !== suppressedDispatchEvent) return;
    if (ownDescriptor) Object.defineProperty(target, "dispatchEvent", ownDescriptor);
    else Reflect.deleteProperty(target, "dispatchEvent");
  };
}

function requireDocuments(job: PrintJob) {
  if (job.documents.length === 0) {
    throw new Error("打印任务没有可输出的记录");
  }
}

function getBatchItems(job: PrintJob) {
  return job.documents.map((_, index) => ({
    variables: getDocumentVariables(job, index),
  }));
}

export type PrintPreviewResult =
  | { kind: "designer"; result: unknown }
  | { kind: "pdf"; blob: Blob };

export async function getPrintPreviewHtml(
  designer: DesignerElement,
  job: PrintJob,
  index = 0,
): Promise<string> {
  requireDocuments(job);
  if (!Number.isInteger(index) || index < 0 || index >= job.documents.length) {
    throw new Error("打印预览记录不存在");
  }
  await designer.setVariables(getDocumentVariables(job, index));
  const html = await designer.getPreviewHtml();
  if (!html.trim()) throw new Error("打印页面生成失败");
  return html;
}

export async function previewPrintJob(
  designer: DesignerElement,
  job: PrintJob,
): Promise<PrintPreviewResult> {
  requireDocuments(job);
  if (job.documents.length === 1) {
    await designer.setVariables(getDocumentVariables(job, 0));
    return { kind: "designer", result: await designer.preview() };
  }
  const blob = await designer.getBatchPdfBlob(
    getBatchItems(job),
    { filename: "duowei-print-preview.pdf" },
  );
  if (!blob) throw new Error("批量预览 PDF 生成失败");
  return { kind: "pdf", blob };
}

export async function printPrintJob(designer: DesignerElement, job: PrintJob) {
  requireDocuments(job);
  const pages: string[] = [];
  try {
    for (let index = 0; index < job.documents.length; index += 1) {
      await designer.setVariables(getDocumentVariables(job, index));
      const html = await designer.getPreviewHtml();
      if (!html.trim()) throw new Error("打印页面生成失败");
      pages.push(html);
    }
  } finally {
    if (job.documents.length > 1) {
      await designer.setVariables(getDocumentVariables(job, 0));
    }
  }
  return printHtmlInCurrentDocument(pages);
}

let releasePreviousPrint: (() => void) | undefined;

async function printHtmlInCurrentDocument(pages: string[]) {
  if (typeof document === "undefined" || typeof window === "undefined" ||
      typeof window.print !== "function" || !document.body) {
    throw new Error("当前浏览器不支持页面打印");
  }
  releasePreviousPrint?.();
  const root = document.createElement("div");
  root.id = "duowei-print-root";
  root.innerHTML = pages.map((html) => `<section class="duowei-print-document">${html}</section>`).join("");
  document.body.appendChild(root);
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    if (cleanupTimer) clearTimeout(cleanupTimer);
    window.removeEventListener("afterprint", cleanup);
    root.remove();
    if (releasePreviousPrint === cleanup) releasePreviousPrint = undefined;
  };
  releasePreviousPrint = cleanup;
  window.addEventListener("afterprint", cleanup, { once: true });
  try {
    const images = Array.from(root.querySelectorAll("img"));
    await Promise.all(images.map((image) => image.decode?.().catch(() => undefined)));
    if (typeof requestAnimationFrame === "function") {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    window.print();
    cleanupTimer = setTimeout(cleanup, 60000);
    (cleanupTimer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
    return { status: "initiated" as const, mode: "browser" as const };
  } catch (cause) {
    cleanup();
    throw cause;
  }
}

export async function exportPrintJob(
  designer: DesignerElement,
  job: PrintJob,
  filename = "duowei-print.pdf",
) {
  requireDocuments(job);
  if (job.documents.length === 1) {
    await designer.setVariables(getDocumentVariables(job, 0));
    return designer.export({ type: "pdf", filename });
  }
  return designer.exportBatchPdf(getBatchItems(job), { filename });
}
