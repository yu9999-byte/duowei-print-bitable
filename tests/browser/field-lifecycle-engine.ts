import "vue-print-designer";
import "vue-print-designer/style.css";
import {
  bindPrintJob,
  composeRenderedPrintPages,
  getPrintPreviewHtml,
  getPersistentTemplateData,
  getPrintJobPdfBlob,
  renderPrintJobPages,
  restorePrintJobVariables,
  type DesignerElement,
} from "../../src/engine/designer-adapter.ts";
import { fieldDataSourceId } from "../../src/core/data-sources.ts";
import type { PrintJob } from "../../src/core/print-job.ts";

const result = document.querySelector<HTMLOutputElement>("#result")!;
const designer = document.querySelector<DesignerElement>("print-designer")!;
const renamedToken = `@${fieldDataSourceId("renamed")}`;
const deletedToken = `@${fieldDataSourceId("deleted")}`;
const unreadableToken = `@${fieldDataSourceId("unreadable")}`;
const content = `改名：${renamedToken}；删除：${deletedToken}；不可读：${unreadableToken}`;

const job: PrintJob = {
  source: { baseId: "field-lifecycle", tableId: "orders", recordIds: ["rec-1", "rec-2"] },
  table: { name: "字段生命周期", fields: [
    { id: "renamed", name: "新字段名", type: "1", isPrimary: true },
    { id: "unreadable", name: "受限字段", type: "1" },
  ] },
  documents: [
    { recordId: "rec-1", values: { 新字段名: "新值一" } },
    { recordId: "rec-2", values: { 新字段名: "新值二" } },
  ],
  generatedAt: "2026-10-12T02:00:00.000Z",
};

const ext = {
  fieldBindings: {
    renamed: "旧字段名",
    deleted: "已删除字段",
    unreadable: "受限字段",
  },
};

function textElement() {
  return {
    id: "lifecycle",
    type: "text",
    x: 24,
    y: 30,
    width: 552,
    height: 80,
    content,
    variable: renamedToken,
    printable: true,
    style: {
      fontSize: 16,
      color: "#202124",
      backgroundColor: "transparent",
      borderColor: "transparent",
      textAlign: "left",
      verticalAlign: "middle",
    },
  };
}

function ordinaryTemplate(layout: "default" | "continuous" = "default") {
  return {
    canvasSize: { width: 600, height: 400 },
    pages: [{ id: "page", elements: [textElement()] }],
    unit: "px",
    showGrid: true,
    allowDragOutsideCanvas: false,
    ext: { ...ext, ...(layout === "continuous" ? { batchLayout: "continuous" } : {}) },
  };
}

function labelTemplate() {
  return {
    canvasSize: { width: 600, height: 240 },
    pages: [{ id: "page", elements: [
      {
        id: "grid",
        type: "multiLabel",
        x: 20,
        y: 20,
        width: 270,
        height: 160,
        rows: 1,
        cols: 2,
        gapX: 20,
        gapY: 0,
        direction: "row",
        dataVariable: "@labels",
        printable: true,
        style: {
          backgroundColor: "transparent",
          borderColor: "#9ca3af",
          borderStyle: "solid",
          borderWidth: 1,
        },
      },
      { ...textElement(), x: 30, y: 40, width: 250, height: 80 },
    ] }],
    unit: "px",
    showGrid: true,
    allowDragOutsideCanvas: false,
    ext: { ...ext, batchLayout: "labels" },
  };
}

function assertText(mode: string, value: string) {
  for (const expected of [
    "新值一",
    "新值二",
    "[字段已失效：已删除字段]",
    "[字段不可读取：受限字段]",
  ]) {
    if (!value.includes(expected)) throw new Error(`${mode} missing ${expected}`);
  }
  if (value.includes("@__duowei_field_")) throw new Error(`${mode} leaked internal field token`);
}

async function assertPdf(mode: string): Promise<number> {
  const blob = await getPrintJobPdfBlob(designer, job, `${mode}.pdf`);
  const signature = new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer());
  if (signature !== "%PDF-") throw new Error(`${mode} did not produce a PDF`);
  return blob.size;
}

async function runMode(mode: "default" | "continuous" | "labels") {
  const template = mode === "labels" ? labelTemplate() : ordinaryTemplate(mode);
  await bindPrintJob(designer, template, job);
  const runtime = designer.getTemplateData() as any;
  const visibleEditorText = (runtime.pages ?? [])
    .flatMap((page: any) => page.elements ?? [])
    .map((element: any) => typeof element.content === "string" ? element.content : "")
    .join("\n");
  if (!visibleEditorText.includes("@新字段名")
      || !visibleEditorText.includes("@已删除字段（字段已失效）")
      || visibleEditorText.includes("@__duowei_field_")) {
    throw new Error(`${mode} editor labels are not friendly`);
  }
  const persistent = getPersistentTemplateData(designer);
  const persistedText = JSON.stringify(persistent);
  for (const token of [renamedToken, deletedToken, unreadableToken]) {
    if (!persistedText.includes(token)) throw new Error(`${mode} lost stable token ${token}`);
  }
  if (persistedText.includes("新值一") || persistedText.includes("新值二")) {
    throw new Error(`${mode} persisted record values`);
  }
  await bindPrintJob(designer, persistent, job);
  const reopenedText = (designer.getTemplateData() as any).pages
    .flatMap((page: any) => page.elements ?? [])
    .map((element: any) => typeof element.content === "string" ? element.content : "")
    .join("\n");
  if (!reopenedText.includes("@新字段名")
      || !reopenedText.includes("@已删除字段（字段已失效）")
      || reopenedText.includes("@__duowei_field_")) {
    throw new Error(`${mode} save and reopen lost friendly labels`);
  }
  if (mode === "default") {
    await restorePrintJobVariables(designer, job, 1);
    const switched = new DOMParser().parseFromString(
      await getPrintPreviewHtml(designer, job, 1),
      "text/html",
    ).body.textContent ?? "";
    for (const expected of [
      "新值二",
      "[字段已失效：已删除字段]",
      "[字段不可读取：受限字段]",
    ]) {
      if (!switched.includes(expected)) throw new Error(`${mode} switched record missing ${expected}`);
    }
    if (switched.includes("新值一") || switched.includes("@__duowei_field_")) {
      throw new Error(`${mode} switched record kept stale or internal values`);
    }
    await restorePrintJobVariables(designer, job, 0);
  }
  const rendered = await renderPrintJobPages(designer, job);
  const parsed = new DOMParser().parseFromString(composeRenderedPrintPages(rendered), "text/html");
  assertText(mode, parsed.body.textContent ?? "");
  const pdfSize = await assertPdf(mode);
  return { mode, pages: rendered.pageCounts.reduce((sum, count) => sum + count, 0), pdfSize };
}

async function run() {
  await customElements.whenDefined("print-designer");
  if (!designer.isReady) {
    await new Promise<void>((resolve) => designer.addEventListener("ready", () => resolve(), { once: true }));
  }
  const modes = [];
  for (const mode of ["default", "continuous", "labels"] as const) {
    modes.push(await runMode(mode));
  }
  return { modes };
}

run().then(
  (value) => { result.textContent = JSON.stringify({ passed: true, ...value }); },
  (cause) => { result.textContent = JSON.stringify({
    passed: false,
    error: cause instanceof Error ? cause.message : String(cause),
  }); },
);
