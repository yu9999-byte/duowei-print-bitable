import type { PrintJob } from "./print-job.ts";
import { getDocumentVariables, prepareTemplateForOutput } from "./data-sources.ts";

type Element = Record<string, unknown>;

export type ContinuousLayout = {
  template: Record<string, unknown>;
  variables: Record<string, unknown> & {
    __duowei_continuous_rows: Record<string, unknown>[];
  };
  variableKey: "__duowei_continuous_rows";
  pageCount: 1;
  recordIds: string[];
  canvasWidth: number;
  canvasHeight: number;
  recordHeight: number;
};

export function hasContinuousLayout(template: unknown): boolean {
  if (!template || typeof template !== "object" || Array.isArray(template)) return false;
  const ext = (template as Record<string, unknown>).ext;
  return Boolean(ext && typeof ext === "object" && !Array.isArray(ext)
    && (ext as Record<string, unknown>).batchLayout === "continuous");
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function templateRecord(template: unknown): Record<string, unknown> {
  if (!template || typeof template !== "object" || Array.isArray(template)) {
    throw new Error("连续纸模板无效");
  }
  return template as Record<string, unknown>;
}

function assertFixedElement(element: Element, canvasWidth: number, canvasHeight: number) {
  if (element.type === "multiLabel") throw new Error("标签模板不能用于连续纸");
  if (element.type === "table") throw new Error("连续纸首版暂不支持表格或关联明细");
  const style = element.style && typeof element.style === "object" && !Array.isArray(element.style)
    ? element.style as Record<string, unknown>
    : {};
  if (style.autoHeight === true || element.autoHeight === true || element.autoPaginate === true) {
    throw new Error("连续纸首版不支持动态高度或自动分页元素");
  }
  if (!finiteCoordinate(element.x) || !finiteCoordinate(element.y)
      || !finitePositive(element.width) || !finitePositive(element.height)) {
    throw new Error("连续纸元素缺少有效位置或尺寸");
  }
  if (element.x + element.width > canvasWidth || element.y + element.height > canvasHeight) {
    throw new Error("连续纸元素超出原模板纸张范围");
  }
}

export function prepareContinuousLayout(template: unknown, job: PrintJob): ContinuousLayout {
  if (!job.documents.length) throw new Error("打印任务没有可输出的记录");
  const source = templateRecord(template);
  const pages = source.pages;
  const size = source.canvasSize as { width?: unknown; height?: unknown } | undefined;
  if (!Array.isArray(pages) || pages.length !== 1) {
    throw new Error("连续纸首版只支持单页模板");
  }
  if (!size || !finitePositive(size.width) || !finitePositive(size.height)) {
    throw new Error("连续纸模板必须设置有效纸张尺寸");
  }
  const sourceElements = pages[0]?.elements;
  if (!Array.isArray(sourceElements) || !sourceElements.length) {
    throw new Error("连续纸模板没有可打印元素");
  }
  for (const element of sourceElements) {
    if (!element || typeof element !== "object" || Array.isArray(element)) {
      throw new Error("连续纸模板包含无效元素");
    }
    assertFixedElement(element as Element, size.width, size.height);
  }

  const finalHeight = size.height * job.documents.length;
  if (!Number.isFinite(finalHeight) || finalHeight <= 0) {
    throw new Error("连续纸最终高度无效");
  }
  const first = prepareTemplateForOutput(source, getDocumentVariables(job, 0));
  const output = structuredClone(first.template) as Record<string, unknown>;
  output.canvasSize = { width: size.width, height: finalHeight };
  const outputPages = output.pages as Array<{ id?: string; elements?: Element[] }>;
  const firstPage = outputPages[0];
  firstPage.elements = [
    {
      id: "__duowei_continuous_grid",
      type: "multiLabel",
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
      rows: job.documents.length,
      cols: 1,
      gapX: 0,
      gapY: 0,
      direction: "row",
      dataVariable: "@__duowei_continuous_rows",
      printable: true,
      style: {
        backgroundColor: "transparent",
        borderColor: "transparent",
        borderStyle: "none",
        borderWidth: 0,
      },
    },
    ...(firstPage.elements ?? []),
  ];

  return {
    template: output,
    variables: {
      ...first.variables,
      __duowei_continuous_rows: job.documents.map((_, index) =>
        prepareTemplateForOutput(source, getDocumentVariables(job, index)).variables),
    },
    variableKey: "__duowei_continuous_rows",
    pageCount: 1,
    recordIds: job.documents.map((document) => document.recordId),
    canvasWidth: size.width,
    canvasHeight: finalHeight,
    recordHeight: size.height,
  };
}
