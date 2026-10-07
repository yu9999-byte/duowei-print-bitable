import "vue-print-designer";
import "vue-print-designer/style.css";
import { generateLabelTemplate } from "../../src/core/template-generator.ts";
import { bindPrintJob, getPersistentTemplateData, renderPrintJobPages,
  type DesignerElement } from "../../src/engine/designer-adapter.ts";
import type { PrintJob } from "../../src/core/print-job.ts";

const job: PrintJob = {
  source: { baseId: "browser-test", tableId: "orders", recordIds: Array.from({ length: 7 }, (_, i) => `rec-${i + 1}`) },
  table: { name: "订单", fields: [
    { id: "order", name: "订单编号", type: "1", isPrimary: true },
    { id: "customer", name: "客户", type: "1" },
  ] },
  documents: Array.from({ length: 7 }, (_, i) => ({
    recordId: `rec-${i + 1}`,
    values: { 订单编号: `PO-${i + 1}`, 客户: `客户${i + 1}` },
  })),
  generatedAt: "2026-09-30T10:00:00.000Z",
};

const button = document.querySelector<HTMLButtonElement>("#run")!;
const download = document.querySelector<HTMLButtonElement>("#download")!;
const result = document.querySelector<HTMLOutputElement>("#result")!;
const designer = document.querySelector<DesignerElement>("print-designer")!;
let lastPdf: Blob | null = null;

download.addEventListener("click", async () => {
  if (!lastPdf) return;
  download.disabled = true;
  try {
    const response = await fetch("/__test/pdf", { method: "POST", body: lastPdf });
    if (!response.ok) throw new Error(`Local PDF save failed: ${response.status}`);
    result.textContent += " PDF saved locally";
  } catch (cause) {
    result.textContent += ` ${String(cause)}`;
  } finally {
    download.disabled = false;
  }
});

button.addEventListener("click", async () => {
  button.disabled = true;
  download.disabled = true;
  lastPdf = null;
  result.textContent = "Running";
  try {
    await customElements.whenDefined("print-designer");
    if (!designer.isReady) {
      await new Promise<void>((resolve) => designer.addEventListener("ready", () => resolve(), { once: true }));
    }
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
    // Exercise the same native PDF renderer without starting a file download.
    const prepared = (await import("../../src/core/label-layout.ts")).prepareLabelLayout(
      getPersistentTemplateData(designer), job);
    if (!designer.loadTemplateData(prepared.template)) throw new Error("PDF template load failed");
    let pdfSize = 0;
    try {
      await designer.setVariables(prepared.variables);
      const blob = await designer.export({ type: "pdfBlob" });
      if (!(blob instanceof Blob) || blob.type !== "application/pdf") throw new Error("Native PDF blob missing");
      pdfSize = blob.size;
      lastPdf = blob;
    } finally {
      if (!designer.loadTemplateData(JSON.parse(original))) throw new Error("PDF template restore failed");
    }
    const passed = rendered.layout === "labels" && rendered.pageCounts[0] === 2
      && pageTexts.length === 2 && restored && pdfSize > 1000
      && occurrences.every((item, i) => item.order === 1 && item.customer === 1 && item.page === (i < 6 ? 1 : 2));
    result.textContent = JSON.stringify({ passed, pageCounts: rendered.pageCounts,
      occurrences, restored, pdfSize, pageText: pageTexts.map((text) => text.slice(0, 230)) });
    download.disabled = !passed;
  } catch (cause) {
    let diagnostic: unknown;
    try {
      const layout = (await import("../../src/core/label-layout.ts")).prepareLabelLayout(
        getPersistentTemplateData(designer), job);
      const original = designer.getTemplateData();
      if (!designer.loadTemplateData(layout.template)) throw new Error("Diagnostic template load failed");
      try {
        await designer.setVariables(layout.variables);
        const html = await designer.getPreviewHtml();
        const pages = new DOMParser().parseFromString(html, "text/html").body.firstElementChild?.children ?? [];
        diagnostic = { sourcePages: designer.shadowRoot?.querySelectorAll(".print-page").length,
          pages: Array.from(pages, (page) => ({ text: page.textContent?.slice(0, 350),
            width: (page as HTMLElement).style.width, height: (page as HTMLElement).style.height,
            children: page.children.length })) };
      } finally {
        designer.loadTemplateData(original);
      }
    } catch (diagnosticError) {
      diagnostic = String(diagnosticError);
    }
    result.textContent = JSON.stringify({ passed: false,
      error: cause instanceof Error ? cause.message : String(cause), diagnostic });
  } finally {
    button.disabled = false;
  }
});
