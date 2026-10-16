import { getDocumentVariables } from "./data-sources.ts";
import { prepareContinuousLayout } from "./continuous-layout.ts";
import { cloneJsonValue } from "./json-clone.ts";
import { prepareLabelLayout } from "./label-layout.ts";
import type { PrintJob } from "./print-job.ts";

export type BatchEditLayout = "default" | "continuous" | "labels";

type JsonRecord = Record<string, any>;

export type BatchEditProjection = {
  layout: BatchEditLayout;
  template: JsonRecord;
  baseTemplate: JsonRecord;
  recordIds: string[];
  elementRecordIndexes: Record<string, number>;
  elementValues: Record<string, Record<string, unknown>>;
  projectionValues: Record<string, unknown>;
  instanceSnapshots: string[];
  recordHeight?: number;
  label?: {
    gridId: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rows: number;
    cols: number;
    gapX: number;
    gapY: number;
    direction: "row" | "column";
    capacity: number;
  };
};

export type ReconciledBatchEditProjection = {
  changed: boolean;
  template: JsonRecord;
  projection: BatchEditProjection;
};

const RECORD_INDEX = "__duoweiBatchRecordIndex";
const SOURCE_ID = "__duoweiBatchSourceId";
const SOURCE_PAGE_INDEX = "__duoweiBatchSourcePageIndex";
const SOURCE_ORDER = "__duoweiBatchSourceOrder";
const SOURCE_VARIABLES = "__duoweiBatchSourceVariables";
const OFFSET_X = "__duoweiBatchOffsetX";
const OFFSET_Y = "__duoweiBatchOffsetY";
const KIND = "__duoweiBatchKind";
const PROJECTION_EXT = "__duoweiBatchProjection";
const VARIABLE_PROPERTIES = ["variable", "columnsVariable", "dataVariable"] as const;

function templateRecord(template: unknown, message = "批量编辑模板无效"): JsonRecord {
  if (!template || typeof template !== "object" || Array.isArray(template)) throw new Error(message);
  return template as JsonRecord;
}

function templatePages(template: JsonRecord): JsonRecord[] {
  if (!Array.isArray(template.pages) || template.pages.length === 0) {
    throw new Error("批量编辑模板没有可编辑页面");
  }
  return template.pages.map((page: unknown) => templateRecord(page, "批量编辑模板包含无效页面"));
}

function pageElements(page: JsonRecord): JsonRecord[] {
  if (!Array.isArray(page.elements)) return [];
  return page.elements.map((element: unknown) => templateRecord(element, "批量编辑模板包含无效组件"));
}

function safeId(value: unknown, fallback: string): string {
  const raw = typeof value === "string" && value.trim() ? value : fallback;
  return raw.replace(/[^A-Za-z0-9_.-]/g, "_");
}

function cloneTopLevel(source: JsonRecord): JsonRecord {
  const output = cloneJsonValue(source) as JsonRecord;
  const ext = output.ext && typeof output.ext === "object" && !Array.isArray(output.ext)
    ? output.ext as JsonRecord
    : {};
  output.ext = { ...ext, [PROJECTION_EXT]: true };
  return output;
}

function projectionVariableKey(recordIndex: number, elementId: string, property: string) {
  return `__duowei_batch_value_r${recordIndex}_${safeId(elementId, "element")}_${property}`;
}

function cloneInstanceElement(input: {
  source: JsonRecord;
  sourceIndex: number;
  recordIndex: number;
  pageIndex: number;
  values: Record<string, unknown>;
  offsetX?: number;
  offsetY?: number;
  elementRecordIndexes: Record<string, number>;
  elementValues: Record<string, Record<string, unknown>>;
  projectionValues: Record<string, unknown>;
}): JsonRecord {
  const sourceId = typeof input.source.id === "string" && input.source.id
    ? input.source.id
    : `element-${input.sourceIndex + 1}`;
  const id = `__duowei_batch_r${input.recordIndex}_p${input.pageIndex}_${safeId(sourceId, `element-${input.sourceIndex + 1}`)}`;
  const output = cloneJsonValue(input.source) as JsonRecord;
  output.id = id;
  output[RECORD_INDEX] = input.recordIndex;
  output[SOURCE_ID] = sourceId;
  output[SOURCE_ORDER] = input.sourceIndex;
  output[OFFSET_X] = input.offsetX ?? 0;
  output[OFFSET_Y] = input.offsetY ?? 0;
  if (typeof output.x === "number") output.x += input.offsetX ?? 0;
  if (typeof output.y === "number") output.y += input.offsetY ?? 0;

  const sourceVariables: JsonRecord = {};
  for (const property of VARIABLE_PROPERTIES) {
    const reference = output[property];
    if (typeof reference !== "string" || !reference.startsWith("@")) continue;
    const key = reference.slice(1);
    if (!Object.prototype.hasOwnProperty.call(input.values, key)) continue;
    const projectedKey = projectionVariableKey(input.recordIndex, id, property);
    sourceVariables[property] = reference;
    output[property] = `@${projectedKey}`;
    input.projectionValues[projectedKey] = input.values[key];
  }
  if (Object.keys(sourceVariables).length) output[SOURCE_VARIABLES] = sourceVariables;
  input.elementRecordIndexes[id] = input.recordIndex;
  input.elementValues[id] = input.values;
  return output;
}

function cloneSharedElement(source: JsonRecord, sourceIndex: number, pageIndex: number, kind: string): JsonRecord {
  const sourceId = typeof source.id === "string" && source.id ? source.id : `element-${sourceIndex + 1}`;
  const output = cloneJsonValue(source) as JsonRecord;
  output.id = `__duowei_batch_shared_p${pageIndex}_${safeId(sourceId, `element-${sourceIndex + 1}`)}`;
  output[SOURCE_ID] = sourceId;
  output[SOURCE_ORDER] = sourceIndex;
  output[KIND] = kind;
  return output;
}

function cloneDefaultProjection(base: JsonRecord, job: PrintJob, state: BatchEditProjection) {
  const sourcePages = templatePages(base);
  const output = cloneTopLevel(base);
  output.pages = job.documents.flatMap((_, recordIndex) => {
    const values = getDocumentVariables(job, recordIndex);
    return sourcePages.map((sourcePage, pageIndex) => {
      const page = cloneJsonValue(sourcePage) as JsonRecord;
      const sourcePageId = typeof sourcePage.id === "string" && sourcePage.id
        ? sourcePage.id
        : `page-${pageIndex + 1}`;
      page.id = `__duowei_batch_r${recordIndex}_p${pageIndex}_${safeId(sourcePageId, `page-${pageIndex + 1}`)}`;
      page[RECORD_INDEX] = recordIndex;
      page[SOURCE_ID] = sourcePageId;
      page[SOURCE_PAGE_INDEX] = pageIndex;
      page.elements = pageElements(sourcePage).map((source, sourceIndex) => cloneInstanceElement({
        source,
        sourceIndex,
        recordIndex,
        pageIndex,
        values,
        elementRecordIndexes: state.elementRecordIndexes,
        elementValues: state.elementValues,
        projectionValues: state.projectionValues,
      }));
      return page;
    });
  });
  return output;
}

function cloneContinuousProjection(base: JsonRecord, job: PrintJob, state: BatchEditProjection) {
  const layout = prepareContinuousLayout(base, job);
  const sourcePage = templatePages(base)[0];
  const output = cloneTopLevel(base);
  const page = cloneJsonValue(sourcePage) as JsonRecord;
  page.id = `__duowei_batch_continuous_${safeId(sourcePage.id, "page-1")}`;
  page[KIND] = "continuous-page";
  page[SOURCE_ID] = typeof sourcePage.id === "string" && sourcePage.id ? sourcePage.id : "page-1";
  page.elements = job.documents.flatMap((_, recordIndex) => {
    const values = getDocumentVariables(job, recordIndex);
    return pageElements(sourcePage).map((source, sourceIndex) => cloneInstanceElement({
      source,
      sourceIndex,
      recordIndex,
      pageIndex: 0,
      values,
      offsetY: layout.recordHeight * recordIndex,
      elementRecordIndexes: state.elementRecordIndexes,
      elementValues: state.elementValues,
      projectionValues: state.projectionValues,
    }));
  });
  output.pages = [page];
  output.canvasSize = { width: layout.canvasWidth, height: layout.canvasHeight };
  state.recordHeight = layout.recordHeight;
  return output;
}

function labelGrid(base: JsonRecord) {
  const page = templatePages(base)[0];
  const elements = pageElements(page);
  const gridIndex = elements.findIndex((element) => element.type === "multiLabel");
  if (gridIndex < 0) throw new Error("标签模板缺少标签网格");
  return { page, elements, grid: elements[gridIndex], gridIndex };
}

function labelCellOffset(label: NonNullable<BatchEditProjection["label"]>, slot: number) {
  const row = label.direction === "row" ? Math.floor(slot / label.cols) : slot % label.rows;
  const col = label.direction === "row" ? slot % label.cols : Math.floor(slot / label.rows);
  return {
    x: col * (label.width + label.gapX),
    y: row * (label.height + label.gapY),
  };
}

function inFirstLabelCell(element: JsonRecord, label: NonNullable<BatchEditProjection["label"]>) {
  return typeof element.x === "number" && typeof element.y === "number"
    && typeof element.width === "number" && typeof element.height === "number"
    && element.x >= label.x && element.y >= label.y
    && element.x + element.width <= label.x + label.width
    && element.y + element.height <= label.y + label.height;
}

function cloneLabelProjection(base: JsonRecord, job: PrintJob, state: BatchEditProjection) {
  const layout = prepareLabelLayout(base, job);
  const { page: sourcePage, elements, grid, gridIndex } = labelGrid(base);
  const label: NonNullable<BatchEditProjection["label"]> = {
    gridId: typeof grid.id === "string" && grid.id ? grid.id : "label-grid",
    x: Number(grid.x),
    y: Number(grid.y),
    width: Number(grid.width),
    height: Number(grid.height),
    rows: Number(grid.rows),
    cols: Number(grid.cols),
    gapX: Number(grid.gapX ?? 0),
    gapY: Number(grid.gapY ?? 0),
    direction: grid.direction === "column" ? "column" : "row",
    capacity: layout.capacity,
  };
  state.label = label;
  const content = elements.map((element, sourceIndex) => ({ element, sourceIndex }))
    .filter(({ element, sourceIndex }) => sourceIndex !== gridIndex && inFirstLabelCell(element, label));
  const shared = elements.map((element, sourceIndex) => ({ element, sourceIndex }))
    .filter(({ element, sourceIndex }) => sourceIndex !== gridIndex && !inFirstLabelCell(element, label));
  const output = cloneTopLevel(base);
  output.pages = Array.from({ length: layout.pageCount }, (_, pageIndex) => {
    const page = cloneJsonValue(sourcePage) as JsonRecord;
    page.id = `__duowei_batch_labels_p${pageIndex}_${safeId(sourcePage.id, "page-1")}`;
    page[KIND] = "labels-page";
    page[SOURCE_ID] = typeof sourcePage.id === "string" && sourcePage.id ? sourcePage.id : "page-1";
    page[SOURCE_PAGE_INDEX] = pageIndex;
    const projectedGrid = cloneSharedElement(grid, gridIndex, pageIndex, "label-grid");
    projectedGrid.dataVariable = `@__duowei_batch_empty_labels_${pageIndex}`;
    projectedGrid.printable = false;
    projectedGrid[SOURCE_VARIABLES] = { dataVariable: grid.dataVariable };
    state.projectionValues[`__duowei_batch_empty_labels_${pageIndex}`] = [];
    const pageRecords = job.documents.flatMap((_, recordIndex) => {
      if (Math.floor(recordIndex / label.capacity) !== pageIndex) return [];
      const slot = recordIndex % label.capacity;
      const offset = labelCellOffset(label, slot);
      const values = getDocumentVariables(job, recordIndex);
      return content.map(({ element, sourceIndex }) => cloneInstanceElement({
        source: element,
        sourceIndex,
        recordIndex,
        pageIndex,
        values,
        offsetX: offset.x,
        offsetY: offset.y,
        elementRecordIndexes: state.elementRecordIndexes,
        elementValues: state.elementValues,
        projectionValues: state.projectionValues,
      }));
    });
    page.elements = [
      projectedGrid,
      ...shared.map(({ element, sourceIndex }) => cloneSharedElement(element, sourceIndex, pageIndex, "label-shared")),
      ...pageRecords,
    ];
    return page;
  });
  return output;
}

export function createBatchEditProjection(
  template: unknown,
  job: PrintJob,
  layout: BatchEditLayout,
): BatchEditProjection {
  if (!job.documents.length) throw new Error("批量编辑没有可用记录");
  const baseTemplate = cloneJsonValue(templateRecord(template));
  const state: BatchEditProjection = {
    layout,
    template: {},
    baseTemplate,
    recordIds: job.documents.map((document) => document.recordId),
    elementRecordIndexes: {},
    elementValues: {},
    projectionValues: {},
    instanceSnapshots: [],
  };
  state.template = layout === "continuous"
    ? cloneContinuousProjection(baseTemplate, job, state)
    : layout === "labels"
      ? cloneLabelProjection(baseTemplate, job, state)
      : cloneDefaultProjection(baseTemplate, job, state);
  state.instanceSnapshots = extractInstances(state.template, state).map((instance) => JSON.stringify(instance));
  return state;
}

function restoreElement(element: JsonRecord, offsetX = 0, offsetY = 0): JsonRecord {
  const output = cloneJsonValue(element) as JsonRecord;
  const sourceVariables = output[SOURCE_VARIABLES] && typeof output[SOURCE_VARIABLES] === "object"
    ? output[SOURCE_VARIABLES] as JsonRecord
    : {};
  if (typeof output[SOURCE_ID] === "string") output.id = output[SOURCE_ID];
  if (typeof output.x === "number") output.x -= Number(output[OFFSET_X] ?? offsetX);
  if (typeof output.y === "number") output.y -= Number(output[OFFSET_Y] ?? offsetY);
  for (const property of VARIABLE_PROPERTIES) {
    const original = sourceVariables[property];
    if (typeof original === "string" && typeof output[property] === "string"
      && output[property].startsWith("@__duowei_batch_")) output[property] = original;
  }
  for (const key of [RECORD_INDEX, SOURCE_ID, SOURCE_ORDER, SOURCE_VARIABLES, OFFSET_X, OFFSET_Y, KIND]) {
    delete output[key];
  }
  return output;
}

function restorePage(page: JsonRecord, elements: JsonRecord[]): JsonRecord {
  const output = cloneJsonValue(page) as JsonRecord;
  if (typeof output[SOURCE_ID] === "string") output.id = output[SOURCE_ID];
  for (const key of [RECORD_INDEX, SOURCE_ID, SOURCE_PAGE_INDEX, KIND]) delete output[key];
  output.elements = elements;
  return output;
}

function normalizedTopLevel(current: JsonRecord, base: JsonRecord): JsonRecord {
  const output = cloneJsonValue(base) as JsonRecord;
  for (const [key, value] of Object.entries(current)) {
    if (key === "pages" || key === "ext" || key === "canvasSize") continue;
    output[key] = cloneJsonValue(value);
  }
  const ext = cloneJsonValue(base.ext ?? {}) as JsonRecord;
  delete ext[PROJECTION_EXT];
  output.ext = ext;
  return output;
}

function inferPageOwners(pages: JsonRecord[], count: number): number[] {
  const owners: number[] = [];
  let current = -1;
  for (let index = 0; index < pages.length; index += 1) {
    const tagged = pages[index][RECORD_INDEX];
    if (Number.isInteger(tagged) && tagged >= 0 && tagged < count) current = tagged;
    if (current < 0) {
      const next = pages.slice(index).find((page) => Number.isInteger(page[RECORD_INDEX]));
      current = Number.isInteger(next?.[RECORD_INDEX]) ? Number(next![RECORD_INDEX]) : 0;
    }
    owners[index] = current;
  }
  return owners;
}

function extractDefaultInstances(current: JsonRecord, projection: BatchEditProjection): JsonRecord[] {
  const pages = templatePages(current);
  const owners = inferPageOwners(pages, projection.recordIds.length);
  return projection.recordIds.map((_, recordIndex) => {
    const output = normalizedTopLevel(current, projection.baseTemplate);
    output.canvasSize = cloneJsonValue(current.canvasSize ?? projection.baseTemplate.canvasSize);
    output.pages = pages.flatMap((page, pageIndex) => owners[pageIndex] === recordIndex
      ? [restorePage(page, pageElements(page).map((element) => restoreElement(element)))]
      : []);
    return output;
  });
}

function elementRecordIndex(element: JsonRecord, recordHeight: number, count: number): number {
  if (Number.isInteger(element[RECORD_INDEX])) return Number(element[RECORD_INDEX]);
  if (typeof element.y !== "number" || typeof element.height !== "number") return -1;
  const first = Math.floor(element.y / recordHeight);
  const last = Math.floor(Math.max(element.y + element.height - 0.001, 0) / recordHeight);
  return first === last && first >= 0 && first < count ? first : -1;
}

function extractContinuousInstances(current: JsonRecord, projection: BatchEditProjection): JsonRecord[] {
  const page = templatePages(current)[0];
  const height = projection.recordHeight!;
  const groups = projection.recordIds.map(() => [] as JsonRecord[]);
  for (const element of pageElements(page)) {
    const recordIndex = elementRecordIndex(element, height, projection.recordIds.length);
    if (recordIndex < 0) throw new Error("连续批量画布中的组件跨越了两个记录区域，请撤销后重试");
    groups[recordIndex].push(element);
  }
  return groups.map((elements, recordIndex) => {
    const output = normalizedTopLevel(current, projection.baseTemplate);
    const currentSize = current.canvasSize as JsonRecord | undefined;
    output.canvasSize = {
      width: currentSize?.width ?? projection.baseTemplate.canvasSize?.width,
      // The compact edit canvas is a projection, never the saved paper size.
      height: projection.baseTemplate.canvasSize.height,
    };
    output.pages = [restorePage(page, elements
      .map((element) => restoreElement(element, 0, recordIndex * height))
      .sort((a, b) => Number(a[SOURCE_ORDER] ?? 0) - Number(b[SOURCE_ORDER] ?? 0)))];
    return output;
  });
}

function inferLabelRecord(element: JsonRecord, pageIndex: number, projection: BatchEditProjection): number {
  if (Number.isInteger(element[RECORD_INDEX])) return Number(element[RECORD_INDEX]);
  const label = projection.label!;
  if (typeof element.x !== "number" || typeof element.y !== "number"
    || typeof element.width !== "number" || typeof element.height !== "number") return -1;
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;
  for (let slot = 0; slot < label.capacity; slot += 1) {
    const offset = labelCellOffset(label, slot);
    if (centerX >= label.x + offset.x && centerX <= label.x + offset.x + label.width
      && centerY >= label.y + offset.y && centerY <= label.y + offset.y + label.height) {
      const index = pageIndex * label.capacity + slot;
      return index < projection.recordIds.length ? index : -1;
    }
  }
  return -1;
}

function extractLabelInstances(current: JsonRecord, projection: BatchEditProjection): JsonRecord[] {
  const pages = templatePages(current);
  const firstPage = pages[0];
  const firstElements = pageElements(firstPage);
  const grid = firstElements.find((element) => element[KIND] === "label-grid");
  if (!grid) throw new Error("批量标签编辑画布缺少标签网格");
  const shared = firstElements.filter((element) => element[KIND] === "label-shared");
  const groups = projection.recordIds.map(() => [] as JsonRecord[]);
  pages.forEach((page, pageIndex) => {
    for (const element of pageElements(page)) {
      if (element[KIND] === "label-grid" || element[KIND] === "label-shared") continue;
      const recordIndex = inferLabelRecord(element, pageIndex, projection);
      if (recordIndex < 0) throw new Error("标签组件不在任何已选记录的标签区域内，请撤销后重试");
      groups[recordIndex].push(element);
    }
  });
  return groups.map((elements, recordIndex) => {
    const output = normalizedTopLevel(current, projection.baseTemplate);
    output.canvasSize = cloneJsonValue(current.canvasSize ?? projection.baseTemplate.canvasSize);
    const slot = recordIndex % projection.label!.capacity;
    const offset = labelCellOffset(projection.label!, slot);
    const restored = [
      restoreElement(grid),
      ...shared.map((element) => restoreElement(element)),
      ...elements.map((element) => restoreElement(element, offset.x, offset.y)),
    ].sort((a, b) => Number(a[SOURCE_ORDER] ?? 0) - Number(b[SOURCE_ORDER] ?? 0));
    output.pages = [restorePage(firstPage, restored)];
    return output;
  });
}

function extractInstances(current: JsonRecord, projection: BatchEditProjection): JsonRecord[] {
  if (projection.layout === "continuous") return extractContinuousInstances(current, projection);
  if (projection.layout === "labels") return extractLabelInstances(current, projection);
  return extractDefaultInstances(current, projection);
}

export function reconcileBatchEditProjection(
  template: unknown,
  projection: BatchEditProjection,
): ReconciledBatchEditProjection {
  const current = templateRecord(template);
  const instances = extractInstances(current, projection);
  const serialized = instances.map((instance) => JSON.stringify(instance));
  const changedIndexes = serialized.flatMap((snapshot, index) =>
    snapshot === projection.instanceSnapshots[index] ? [] : [index]);
  let nextTemplate = projection.baseTemplate;
  if (changedIndexes.length) {
    const variants = new Set(changedIndexes.map((index) => serialized[index]));
    if (variants.size > 1) {
      throw new Error("检测到多个实例存在不同修改；请一次只编辑一个批量实例，系统不会静默选择覆盖");
    }
    nextTemplate = instances[changedIndexes[0]];
  }
  const changed = JSON.stringify(nextTemplate) !== JSON.stringify(projection.baseTemplate);
  return {
    changed,
    template: cloneJsonValue(nextTemplate),
    projection: {
      ...projection,
      baseTemplate: cloneJsonValue(nextTemplate),
      instanceSnapshots: serialized,
    },
  };
}
