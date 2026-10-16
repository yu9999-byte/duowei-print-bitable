import "vue-print-designer";
import "vue-print-designer/style.css";
import {
  bindPrintJob,
  composeBrowserPrintDocument,
  getPersistentTemplateData,
  getPrintJobPdfBlob,
  getPrintPreviewHtml,
  renderPrintJobPages,
  type DesignerElement,
} from "../../src/engine/designer-adapter.ts";
import { fieldDataSourceId } from "../../src/core/data-sources.ts";
import type { PrintJob } from "../../src/core/print-job.ts";
import { renderAutomationArtifactInBrowser } from "../../src/automation/renderer-browser.ts";
import { validateRenderedArtifact } from "../../src/automation/automation-artifact.ts";
import type { AutomationRenderRequest } from "../../src/automation/automation-domain.ts";

const result = document.querySelector<HTMLOutputElement>("#result")!;
const designer = document.querySelector<DesignerElement>("print-designer")!;
const orderToken = `@${fieldDataSourceId("order")}`;
const imageToken = `@${fieldDataSourceId("image")}`;
const linesToken = `@${fieldDataSourceId("lines")}`;
const imageValue = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='120'%3E%3Crect width='180' height='120' fill='%233370ff'/%3E%3C/svg%3E";

const job: PrintJob = {
  source: { baseId: "component-matrix", tableId: "orders", recordIds: ["record-1"] },
  table: { name: "组件矩阵", fields: [
    { id: "order", name: "订单编号", type: "1", isPrimary: true },
    { id: "image", name: "商品图片", type: "17" },
    { id: "lines", name: "订单明细", type: "21", isArray: true, columns: [
      { field: "商品", header: "商品" },
      { field: "数量", header: "数量" },
    ] },
  ] },
  documents: [{ recordId: "record-1", values: {
    订单编号: "DW-COMP-001",
    商品图片: imageValue,
    订单明细: [{ 商品: "工业标签打印机", 数量: 2 }, { 商品: "标签纸", 数量: 6 }],
  } }],
  generatedAt: "2026-10-12T08:00:00.000Z",
};

const template = {
  canvasSize: { width: 794, height: 1123 },
  unit: "px",
  showGrid: true,
  allowDragOutsideCanvas: false,
  pages: [{ id: "matrix-page", elements: [
    {
      id: "matrix-text", type: "text", x: 30, y: 30, width: 260, height: 72,
      content: `订单：${orderToken}\n第二行`, variable: orderToken, printable: true,
      autoHeight: true,
      style: { fontSize: 16, color: "#111827", backgroundColor: "transparent",
        borderColor: "transparent", textAlign: "left" },
    },
    {
      id: "matrix-image", type: "image", x: 320, y: 30, width: 180, height: 120,
      content: "", variable: imageToken, printable: true,
      style: { objectFit: "contain", opacity: 90, borderStyle: "solid", borderWidth: 1,
        borderColor: "#3370ff" },
    },
    {
      id: "matrix-table", type: "table", x: 30, y: 190, width: 500, height: 190,
      variable: linesToken, columnsVariable: "", footerDataVariable: "",
      columns: [{ field: "商品", header: "商品", width: 250 }, { field: "数量", header: "数量", width: 100 }],
      data: [], showHeader: true, showFooter: false, tfootRepeat: false, autoPaginate: true,
      designOmitRows: false, footerData: [], printable: true,
      style: { backgroundColor: "transparent", borderColor: "#111827", rowHeight: 32,
        textAlign: "left", headerBackgroundColor: "#f2f3f5", headerColor: "#111827" },
    },
    {
      id: "matrix-line", type: "line", x: 30, y: 430, width: 500, height: 20,
      printable: true, style: { borderColor: "#3370ff", borderWidth: 2 },
    },
    {
      id: "matrix-rect", type: "rect", x: 30, y: 480, width: 240, height: 100,
      printable: true, style: { backgroundColor: "#e8f0ff", borderStyle: "solid",
        borderWidth: 2, borderColor: "#3370ff", borderRadius: 8 },
    },
    {
      id: "matrix-page-number", type: "pageNumber", x: 620, y: 1060, width: 100, height: 24,
      format: "Page 1", labelText: "第", labelPosition: "before", printable: true,
      style: { fontSize: 12, color: "#646a73", textAlign: "right",
        backgroundColor: "transparent", borderColor: "transparent" },
    },
  ] }],
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function designerRoot(): ShadowRoot | DesignerElement {
  return designer.shadowRoot ?? designer;
}

function pageCanvas(): HTMLElement {
  const page = designerRoot().querySelector<HTMLElement>("#page-0");
  assert(page, "designer page canvas is unavailable");
  return page;
}

async function dropComponent(type: string, x: number, y: number): Promise<string> {
  const before = getPersistentTemplateData(designer) as typeof template;
  const knownIds = new Set(before.pages.flatMap((page) => page.elements.map((element) => element.id)));
  const page = pageCanvas();
  const rect = page.getBoundingClientRect();
  const transfer = new DataTransfer();
  transfer.setData("application/json", JSON.stringify({ type }));
  page.dispatchEvent(new DragEvent("dragover", {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: rect.left + x,
    clientY: rect.top + y,
    dataTransfer: transfer,
  }));
  page.dispatchEvent(new DragEvent("drop", {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: rect.left + x,
    clientY: rect.top + y,
    dataTransfer: transfer,
  }));
  await nextFrame();
  const after = getPersistentTemplateData(designer) as typeof template;
  const created = after.pages.flatMap((candidate) => candidate.elements)
    .find((element) => !knownIds.has(element.id));
  assert(created && created.type === type, `${type} component was not created through the app drag payload`);
  return created.id;
}

async function selectElement(id: string): Promise<HTMLElement> {
  const element = designerRoot().querySelector<HTMLElement>(`.element-wrapper[data-element-id="${id}"]`);
  assert(element, `canvas element ${id} is unavailable`);
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, composed: true }));
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
  await nextFrame();
  return element;
}

function propertyControl(label: string): HTMLInputElement | HTMLTextAreaElement {
  const labels = Array.from(designerRoot().querySelectorAll("label"));
  const match = labels.find((candidate) => candidate.textContent?.trim() === label);
  const control = match?.parentElement?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
  assert(control, `property control ${label} is unavailable`);
  return control;
}

async function updateProperty(label: string, value: string): Promise<void> {
  const control = propertyControl(label);
  control.value = value;
  control.dispatchEvent(new Event(control instanceof HTMLTextAreaElement ? "input" : "change", {
    bubbles: true,
    composed: true,
  }));
  await nextFrame();
  assert(control.value === value, `property control ${label} did not reflect ${value}`);
}

async function removeSelectedElement(element: HTMLElement): Promise<void> {
  element.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Delete",
    bubbles: true,
    cancelable: true,
    composed: true,
  }));
  await nextFrame();
}

function automationRequest(
  snapshot: unknown,
  outputType: "pdf" | "png",
): AutomationRenderRequest {
  return {
    artifactKey: `duowei:v1:component-matrix-${outputType}`,
    template: { id: "component-matrix", revision: "interaction-1", snapshot },
    values: {
      order: "DW-COMP-001",
      image: imageValue,
      lines: [{ 商品: "工业标签打印机", 数量: 2 }, { 商品: "标签纸", 数量: 6 }],
    },
    output: { type: outputType, pageLimit: outputType === "png" ? 1 : null },
  };
}

async function run() {
  await customElements.whenDefined("print-designer");
  if (!designer.isReady) {
    await new Promise<void>((resolve) => designer.addEventListener("ready", () => resolve(), { once: true }));
  }
  await bindPrintJob(designer, template, job);
  const interactiveTextId = await dropComponent("text", 520, 650);
  const interactiveText = await selectElement(interactiveTextId);
  await updateProperty("X (px)", "80");
  await updateProperty("Y (px)", "640");
  await updateProperty("宽度 (px)", "320");
  await updateProperty("高度 (px)", "90");
  await updateProperty("内容", `新建组件：${orderToken}\n可编辑第二行`);
  await updateProperty("变量", orderToken);

  const afterPropertyEdit = getPersistentTemplateData(designer) as typeof template;
  const editedText = afterPropertyEdit.pages[0].elements.find((element) => element.id === interactiveTextId);
  assert(editedText, "created text component disappeared after property editing");
  assert(editedText.x === 80 && editedText.y === 640, "X/Y property changes did not move the component");
  assert(editedText.width === 320 && editedText.height === 90, "width/height property changes did not resize the component");
  assert(editedText.content === `新建组件：${orderToken}\n可编辑第二行`, "text property change was not persisted");
  assert(editedText.variable === orderToken, "field binding was not persisted on the created component");
  assert(interactiveText.style.left === "80px" && interactiveText.style.top === "640px",
    "canvas did not immediately reflect the X/Y property changes");
  assert(interactiveText.style.width === "320px" && interactiveText.style.height === "90px",
    "canvas did not immediately reflect the width/height property changes");

  const temporaryRectId = await dropComponent("rect", 440, 700);
  const temporaryRect = await selectElement(temporaryRectId);
  await removeSelectedElement(temporaryRect);
  const afterDelete = getPersistentTemplateData(designer) as typeof template;
  assert(!afterDelete.pages.some((page) => page.elements.some((element) => element.id === temporaryRectId)),
    "Delete did not remove the selected temporary component");

  const saved = afterDelete;
  const savedTypes = saved.pages[0].elements.map((element) => element.type);
  for (const type of ["text", "image", "table", "line", "rect", "pageNumber"]) {
    assert(savedTypes.includes(type), `save snapshot did not preserve ${type}`);
  }
  assert(JSON.stringify(saved).includes(orderToken), "text binding was lost on save");
  assert(JSON.stringify(saved).includes(imageToken), "image binding was lost on save");
  assert(JSON.stringify(saved).includes(linesToken), "table binding was lost on save");
  assert(!JSON.stringify(saved).includes("DW-COMP-001"), "record value leaked into saved template");

  assert(designer.loadTemplateData(saved), "saved component template did not reload");
  await bindPrintJob(designer, saved, job);
  const html = await getPrintPreviewHtml(designer, job, 0);
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const text = parsed.body.textContent ?? "";
  assert(text.includes("DW-COMP-001"), "text component did not render the real record value");
  assert(text.includes("第二行"), "multi-line text did not preserve its second line");
  assert(text.includes("新建组件：DW-COMP-001") && text.includes("可编辑第二行"),
    "created text component did not restore its binding and multi-line content");
  assert(text.includes("工业标签打印机") && text.includes("标签纸"), "table did not render linked rows");
  assert(parsed.querySelectorAll("img").length >= 1, "image component did not render");
  for (const id of ["matrix-text", "matrix-image", "matrix-table", "matrix-line", "matrix-rect", "matrix-page-number"]) {
    assert(parsed.querySelector(`[data-element-id="${id}"]`), `preview lost ${id}`);
  }
  assert(parsed.querySelector(`[data-element-id="${interactiveTextId}"]`), "preview lost the created text component");

  const rendered = await renderPrintJobPages(designer, job);
  const browserPrintHtml = composeBrowserPrintDocument(rendered);
  assert(browserPrintHtml.includes("DW-COMP-001"), "browser print HTML lost the real record value");
  assert(browserPrintHtml.includes(`data-element-id="${interactiveTextId}"`),
    "browser print HTML lost the created text component");
  assert(browserPrintHtml.includes('data-duowei-print-page="true"'),
    "browser print HTML did not preserve paper boundaries");

  const pdf = await getPrintJobPdfBlob(designer, job, "component-matrix.pdf");
  const signature = new TextDecoder().decode(await pdf.slice(0, 5).arrayBuffer());
  assert(signature === "%PDF-", "component matrix did not produce a valid PDF");
  assert(pdf.size > 1_000, "component matrix PDF is unexpectedly empty");

  const pngRequest = automationRequest(saved, "png");
  const png = validateRenderedArtifact(
    pngRequest.artifactKey,
    "png",
    await renderAutomationArtifactInBrowser(designer, pngRequest),
  );

  return {
    savedTypes,
    interaction: {
      created: true,
      selected: true,
      moved: { x: editedText.x, y: editedText.y },
      resized: { width: editedText.width, height: editedText.height },
      deleted: true,
      boundField: "订单编号",
      restored: true,
    },
    preview: {
      text: true,
      multiline: true,
      image: true,
      table: true,
      line: true,
      rect: true,
      pageNumber: true,
    },
    outputs: {
      previewHtml: true,
      browserPrintHtml: true,
      pdfBytes: pdf.size,
      pngBytes: png.bytes.byteLength,
    },
    pdfBytes: pdf.size,
  };
}

run().then(
  (value) => { result.textContent = JSON.stringify({ passed: true, ...value }); },
  (cause) => { result.textContent = JSON.stringify({
    passed: false,
    error: cause instanceof Error ? cause.message : String(cause),
  }); },
);
