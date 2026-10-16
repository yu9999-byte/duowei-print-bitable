import type { PrintJob } from "./print-job.ts";
import {
  createPrintJobDataSourceTokenCodec,
  getDocumentVariables,
  prepareTemplateForOutput,
} from "./data-sources.ts";

type Element = Record<string, unknown>;
type LabelLayout = {
  template: Record<string, unknown>;
  variables: Record<string, unknown> & { labels: Record<string, unknown>[] };
  variableKey: string;
  capacity: number;
  pageCount: number;
  recordIds: string[];
  canvasWidth: number;
  canvasHeight: number;
};

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function coordinate(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : NaN;
}

export function hasNativeLabelGrid(template: unknown): boolean {
  if (!template || typeof template !== "object" || Array.isArray(template)) return false;
  const pages = (template as Record<string, unknown>).pages;
  return Array.isArray(pages) && pages.some((page) =>
    page && typeof page === "object" && Array.isArray(page.elements)
      && page.elements.some((element: Element) => element?.type === "multiLabel"));
}

export function prepareLabelLayout(template: unknown, job: PrintJob): LabelLayout {
  if (!job.documents.length) throw new Error("打印任务没有可输出的记录");
  if (!template || typeof template !== "object" || Array.isArray(template)) {
    throw new Error("标签模板无效");
  }
  const source = template as Record<string, unknown>;
  const pages = source.pages;
  const size = source.canvasSize as { width?: unknown; height?: unknown } | undefined;
  if (!Array.isArray(pages) || pages.length !== 1 || !size ||
      !finitePositive(size.width) || !finitePositive(size.height)) {
    throw new Error("标签模板必须只有一页且设置有效纸张尺寸");
  }
  const elements = pages[0]?.elements as Element[] | undefined;
  if (!Array.isArray(elements)) throw new Error("标签模板没有元素");
  const grids = elements.filter((element) => element?.type === "multiLabel");
  if (grids.length !== 1) throw new Error("标签模板必须恰好有一个标签网格");
  const grid = grids[0];
  const { x, y, width, height, gapX, gapY, rows, cols } = grid;
  const gx = coordinate(x);
  const gy = coordinate(y);
  const horizontalGap = gapX === undefined ? 0 : coordinate(gapX);
  const verticalGap = gapY === undefined ? 0 : coordinate(gapY);
  if (gx < 0 || gy < 0 || !finitePositive(width) || !finitePositive(height) ||
      horizontalGap < 0 || verticalGap < 0 ||
      !Number.isInteger(rows) || !Number.isInteger(cols) || Number(rows) < 1 || Number(cols) < 1 ||
      !["row", "column"].includes(String(grid.direction))) {
    throw new Error("标签网格尺寸、行列或方向无效");
  }
  if (gx + Number(cols) * width + (Number(cols) - 1) * horizontalGap > size.width ||
      gy + Number(rows) * height + (Number(rows) - 1) * verticalGap > size.height) {
    throw new Error("标签网格超出纸张，请调整首格、行列或间距");
  }
  const key = typeof grid.dataVariable === "string" && /^@[A-Za-z0-9_.-]+$/.test(grid.dataVariable)
    ? grid.dataVariable.slice(1) : "";
  if (!key) throw new Error("标签网格缺少数组数据源");
  let labelElements = 0;
  for (const element of elements) {
    if (element === grid) continue;
    const ex = coordinate(element.x);
    const ey = coordinate(element.y);
    const ew = element.width;
    const eh = element.height;
    if (!Number.isFinite(ex) || !Number.isFinite(ey) || !finitePositive(ew) || !finitePositive(eh)) {
      throw new Error("标签元素缺少有效位置或尺寸");
    }
    const centerX = ex + ew / 2;
    const centerY = ey + eh / 2;
    const inFirstCell = centerX >= gx && centerX <= gx + width
      && centerY >= gy && centerY <= gy + height;
    if (inFirstCell) {
      if (element.type === "table") throw new Error("标签首格暂不支持表格组件");
      if (ex < gx || ey < gy || ex + ew > gx + width || ey + eh > gy + height) {
        throw new Error("标签元素必须完整位于首格");
      }
      labelElements += 1;
    } else if (element.variable || element.columnsVariable || element.dataVariable ||
        (typeof element.content === "string" && /@__duowei_/.test(element.content))) {
      throw new Error("标签页外动态元素无法逐记录绑定");
    }
  }
  if (!labelElements) throw new Error("标签首格没有可打印元素");

  const codec = createPrintJobDataSourceTokenCodec(job, source);
  const first = prepareTemplateForOutput(source, getDocumentVariables(job, 0), codec);
  const variables = {
    ...first.variables,
    [key]: job.documents.map((_, index) =>
      prepareTemplateForOutput(source, getDocumentVariables(job, index), codec).variables),
  };
  const capacity = Number(rows) * Number(cols);
  return {
    template: first.template,
    variables: variables as LabelLayout["variables"],
    variableKey: key,
    capacity,
    pageCount: Math.ceil(job.documents.length / capacity),
    recordIds: job.documents.map((document) => document.recordId),
    canvasWidth: size.width,
    canvasHeight: size.height,
  };
}
