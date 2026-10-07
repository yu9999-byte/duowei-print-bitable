import type { PrintJob } from "../core/print-job.ts";
import { renderWhenVisible } from "./preview-visibility.ts";
import { generateTemplate } from "../core/template-generator.ts";
import { hasNativeLabelGrid, prepareLabelLayout } from "../core/label-layout.ts";
import { hasContinuousLayout, prepareContinuousLayout } from "../core/continuous-layout.ts";
import {
  createDataSourceTokenCodec,
  type DataSourceTokenCodec,
  type DataSourceTokenDefinition,
  type PastedDataSourceBinding,
} from "../core/data-source-token-codec.ts";
import {
  buildDataSourceCatalog,
  fieldDataSourceId,
  getDocumentVariables,
  prepareTemplateForOutput,
  refreshTemplateDataSources,
  SYSTEM_PRINT_DATE_ID,
  type DataSourceClipboardPayload,
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

export type PdfExportResult = {
  filename: string;
  bytes: number;
  pages: number;
  pageSizes?: Array<{ width: number; height: number }>;
};

const RUNTIME_SOURCE_CONTENT = "__duoweiSourceContent";
const RUNTIME_SOURCE_VARIABLE = "__duoweiSourceVariable";
const MANAGED_TOKEN_PATTERN = /@__duowei_(?:field|system|print_empty)_[A-Za-z0-9_.-]+/g;

type DesignerDataSourceState = {
  codec: DataSourceTokenCodec;
  persistentExt: Record<string, unknown>;
  values: Record<string, unknown>;
  runtimeValues: Record<string, unknown>;
  clipboard?: DataSourceClipboardPayload;
  pendingBindings: Map<string, PastedDataSourceBinding[]>;
  synchronizing: boolean;
  onChange?: () => void;
  onError?: (error: Error) => void;
};

const designerDataSourceStates = new WeakMap<DesignerElement, DesignerDataSourceState>();
const designerLifecycleOptions = new WeakMap<DesignerElement, {
  onChange?: () => void;
  onError?: (error: Error) => void;
}>();

function templateRecord(template: unknown): Record<string, unknown> {
  if (!template || typeof template !== "object" || Array.isArray(template)) {
    throw new Error("打印模板格式无效");
  }
  return template as Record<string, unknown>;
}

function templateElements(template: Record<string, unknown>) {
  const result: Array<Record<string, unknown>> = [];
  if (!Array.isArray(template.pages)) return result;
  for (const page of template.pages) {
    if (!page || typeof page !== "object" || !Array.isArray(page.elements)) continue;
    for (const element of page.elements) {
      if (element && typeof element === "object" && !Array.isArray(element)) {
        result.push(element as Record<string, unknown>);
      }
    }
  }
  return result;
}

function getHistoricalBindings(template: Record<string, unknown>): Record<string, string> {
  const ext = template.ext;
  if (!ext || typeof ext !== "object" || Array.isArray(ext)) return {};
  const bindings = (ext as Record<string, unknown>).fieldBindings;
  if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) return {};
  return Object.fromEntries(Object.entries(bindings).filter((entry): entry is [string, string] =>
    typeof entry[1] === "string"));
}

function getDataSourceDefinitions(job: PrintJob): DataSourceTokenDefinition[] {
  return [
    ...job.table.fields.map((field) => ({ id: fieldDataSourceId(field.id), label: field.name })),
    { id: SYSTEM_PRINT_DATE_ID, label: "打印日期" },
    ...job.table.fields.filter((field) => field.isLink).map((field) => ({
      id: `__duowei_print_empty_${field.id}`,
      label: `${field.name}（空数据提示）`,
    })),
  ];
}

function renderKey(element: Record<string, unknown>, index: number) {
  const raw = typeof element.id === "string" && element.id.trim() ? element.id : String(index);
  return `__duowei_render_${raw.replace(/[^A-Za-z0-9_.-]/g, "_")}`;
}

function firstManagedToken(content: string): string {
  MANAGED_TOKEN_PATTERN.lastIndex = 0;
  return content.match(MANAGED_TOKEN_PATTERN)?.[0] ?? "";
}

function toRuntimeTemplate(
  persistentTemplate: Record<string, unknown>,
  state: DesignerDataSourceState,
): Record<string, unknown> {
  const runtime = structuredClone(persistentTemplate);
  const runtimeValues = { ...state.values };
  templateElements(runtime).forEach((element, index) => {
    if (element.type !== "text") return;
    const content = typeof element.content === "string" ? element.content : "";
    const variable = typeof element.variable === "string" ? element.variable : "";
    const sourceContent = content || variable;
    MANAGED_TOKEN_PATTERN.lastIndex = 0;
    if (!MANAGED_TOKEN_PATTERN.test(sourceContent)) return;
    const key = renderKey(element, index);
    element[RUNTIME_SOURCE_CONTENT] = sourceContent;
    element[RUNTIME_SOURCE_VARIABLE] = variable;
    element.content = state.codec.toEditingContent(sourceContent).content;
    element.variable = `@${key}`;
    runtimeValues[key] = state.codec.toRenderedContent(sourceContent, state.values).content;
  });
  state.runtimeValues = runtimeValues;
  return runtime;
}

function throwForBindingIssues(issues: ReturnType<DataSourceTokenCodec["toPersistentContent"]>["issues"]) {
  const ambiguous = issues.find((issue) => issue.kind === "ambiguous");
  if (ambiguous) {
    throw new Error(`数据源“${ambiguous.label}”对应多个字段，请从左侧重新复制该字段后粘贴`);
  }
}

function toPersistentTemplate(
  runtimeTemplate: Record<string, unknown>,
  state: DesignerDataSourceState,
): Record<string, unknown> {
  const persistent = structuredClone(runtimeTemplate);
  delete persistent.testData;
  templateElements(persistent).forEach((element) => {
    if (element.type !== "text") return;
    const managed = typeof element[RUNTIME_SOURCE_CONTENT] === "string";
    const previousContent = managed
      ? element[RUNTIME_SOURCE_CONTENT] as string
      : "";
    const editingContent = typeof element.content === "string" ? element.content : "";
    const elementId = typeof element.id === "string" ? element.id : "";
    const pastedBindings = state.pendingBindings.get(elementId) ?? [];
    const converted = state.codec.toPersistentContent(editingContent, {
      previousContent,
      pastedBindings,
    });
    throwForBindingIssues(converted.issues);
    if (!managed && converted.content === editingContent) return;
    const sourceVariable = typeof element[RUNTIME_SOURCE_VARIABLE] === "string"
      ? element[RUNTIME_SOURCE_VARIABLE] as string
      : "";
    const inferredVariable = firstManagedToken(converted.content);
    element.content = converted.content;
    element.variable = sourceVariable && converted.content.includes(sourceVariable)
      ? sourceVariable
      : inferredVariable;
    delete element[RUNTIME_SOURCE_CONTENT];
    delete element[RUNTIME_SOURCE_VARIABLE];
  });
  const runtimeExt = persistent.ext && typeof persistent.ext === "object" && !Array.isArray(persistent.ext)
    ? persistent.ext as Record<string, unknown>
    : {};
  persistent.ext = { ...state.persistentExt, ...runtimeExt };
  return persistent;
}

export function getPersistentTemplateData(designer: DesignerElement): Record<string, unknown> {
  const raw = templateRecord(designer.getTemplateData());
  const state = designerDataSourceStates.get(designer);
  if (!state) return structuredClone(raw);
  return toPersistentTemplate(raw, state);
}

export function rememberCopiedDataSource(
  designer: DesignerElement,
  payload: DataSourceClipboardPayload,
) {
  const state = designerDataSourceStates.get(designer);
  if (state) state.clipboard = payload;
}

export async function synchronizeDesignerDataSources(designer: DesignerElement) {
  const state = designerDataSourceStates.get(designer);
  if (!state || state.synchronizing) return;
  state.synchronizing = true;
  try {
    const persistent = getPersistentTemplateData(designer);
    const ext = persistent.ext;
    state.persistentExt = ext && typeof ext === "object" && !Array.isArray(ext)
      ? structuredClone(ext as Record<string, unknown>)
      : {};
    const runtime = toRuntimeTemplate(persistent, state);
    if (!designer.loadTemplateData(runtime)) {
      throw new Error("数据源失焦后无法刷新打印画布");
    }
    await designer.setTestData(state.runtimeValues);
    await designer.setVariables(state.runtimeValues);
    state.pendingBindings.clear();
    state.onChange?.();
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error("数据源编辑同步失败");
    state.onError?.(error);
    throw error;
  } finally {
    state.synchronizing = false;
  }
}

function eventTextarea(event: Event): HTMLTextAreaElement | null {
  const target = (typeof event.composedPath === "function" ? event.composedPath()[0] : event.target) as
    | Element
    | null;
  return target?.tagName === "TEXTAREA" && target.closest(".element-wrapper[data-element-id] [data-text-content]")
    ? target as HTMLTextAreaElement
    : null;
}

function textareaElementId(textarea: HTMLTextAreaElement): string {
  return textarea.closest(".element-wrapper[data-element-id]")?.getAttribute("data-element-id") ?? "";
}

export function installDataSourceEditingLifecycle(
  designer: DesignerElement,
  options: { onChange?: () => void; onError?: (error: Error) => void } = {},
): () => void {
  designerLifecycleOptions.set(designer, options);
  const state = designerDataSourceStates.get(designer);
  if (state) {
    state.onChange = options.onChange;
    state.onError = options.onError;
  }
  const root = designer.shadowRoot;
  if (!root) return () => designerLifecycleOptions.delete(designer);

  let synchronizationQueued = false;
  const queueSynchronization = () => {
    if (synchronizationQueued) return;
    synchronizationQueued = true;
    queueMicrotask(() => {
      synchronizationQueued = false;
      void synchronizeDesignerDataSources(designer).catch(() => undefined);
    });
  };
  const handlePaste = (event: Event) => {
    const textarea = eventTextarea(event);
    const currentState = designerDataSourceStates.get(designer);
    if (!textarea || !currentState?.clipboard) return;
    const clipboardEvent = event as ClipboardEvent;
    const text = clipboardEvent.clipboardData?.getData("text/plain") ?? "";
    if (text !== currentState.clipboard.text) return;
    const elementId = textareaElementId(textarea);
    if (!elementId) return;
    const binding: PastedDataSourceBinding = {
      label: currentState.clipboard.label,
      token: currentState.clipboard.token,
      offset: textarea.selectionStart ?? undefined,
    };
    currentState.pendingBindings.set(elementId, [
      ...(currentState.pendingBindings.get(elementId) ?? []),
      binding,
    ]);
  };
  const handleFocusOut = (event: Event) => {
    if (eventTextarea(event)) queueSynchronization();
  };
  const handleKeyDown = (event: Event) => {
    const textarea = eventTextarea(event);
    const keyboardEvent = event as KeyboardEvent;
    if (textarea && keyboardEvent.key === "Enter" && !keyboardEvent.shiftKey) {
      queueSynchronization();
    }
  };

  root.addEventListener("paste", handlePaste, { capture: true });
  root.addEventListener("focusout", handleFocusOut);
  root.addEventListener("keydown", handleKeyDown);
  return () => {
    root.removeEventListener("paste", handlePaste, { capture: true });
    root.removeEventListener("focusout", handleFocusOut);
    root.removeEventListener("keydown", handleKeyDown);
    designerLifecycleOptions.delete(designer);
  };
}

export function getDesigner(element: Element | null): DesignerElement {
  if (!(element instanceof HTMLElement) || element.tagName.toLowerCase() !== "print-designer") {
    throw new Error("真实打印设计器尚未挂载");
  }
  return element as DesignerElement;
}

export async function bindPrintJob(designer: DesignerElement, template: unknown, job: PrintJob) {
  const persistentTemplate = refreshTemplateDataSources(
    template ?? generateTemplate(job),
    job.table.fields,
  );
  const existingState = designerDataSourceStates.get(designer);
  const lifecycleOptions = designerLifecycleOptions.get(designer);
  const values = getDocumentVariables(job, 0);
  const state: DesignerDataSourceState = {
    codec: createDataSourceTokenCodec(
      getDataSourceDefinitions(job),
      getHistoricalBindings(persistentTemplate),
    ),
    persistentExt: structuredClone(persistentTemplate.ext),
    values,
    runtimeValues: values,
    clipboard: existingState?.clipboard,
    pendingBindings: new Map(),
    synchronizing: false,
    onChange: lifecycleOptions?.onChange ?? existingState?.onChange,
    onError: lifecycleOptions?.onError ?? existingState?.onError,
  };
  designerDataSourceStates.set(designer, state);
  const runtimeTemplate = toRuntimeTemplate(persistentTemplate, state);
  if (!designer.loadTemplateData(runtimeTemplate)) throw new Error("打印模板无法加载");
  designer.setAvailableVariables?.(buildDataSourceCatalog(job.table.fields));
  await designer.setTestData(state.runtimeValues);
  await designer.setVariables(state.runtimeValues);
}

export async function bindStoredTemplateOrFallback(
  designer: DesignerElement,
  storedTemplate: unknown,
  job: PrintJob,
): Promise<string | null> {
  if (!storedTemplate) {
    await bindPrintJob(designer, null, job);
    return null;
  }
  try {
    await bindPrintJob(designer, storedTemplate, job);
    return null;
  } catch (cause) {
    await bindPrintJob(designer, null, job);
    return cause instanceof Error ? cause.message : "原模板无法加载";
  }
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

export function installDesignerSaveInterception(target: EventTarget, save: () => void): () => void {
  const handleSave = (event: Event) => {
    event.stopImmediatePropagation();
    save();
  };
  for (const name of ["designer:save", "designer:save-as"]) {
    target.addEventListener(name, handleSave, { capture: true });
  }
  return () => {
    for (const name of ["designer:save", "designer:save-as"]) {
      target.removeEventListener(name, handleSave, { capture: true });
    }
  };
}

export function installDesignerWorkspaceChrome(designer: DesignerElement, target: EventTarget): () => void {
  const root = designer.shadowRoot;
  if (!root) return () => undefined;
  // Locked to vue-print-designer 1.7.39: host owns components and save.
  const style = document.createElement("style");
  style.textContent = `
    header.h-14 { display: none !important; }
    button[title="元素库"], button[title="模版列表"] { display: none !important; }
  `;
  root.appendChild(style);
  target.dispatchEvent(new Event("designer:close-elements-panel"));
  const preventSecondPanel = (event: Event) => {
    event.stopImmediatePropagation();
  };
  target.addEventListener("designer:toggle-elements-panel", preventSecondPanel, { capture: true });
  return () => {
    style.remove();
    target.removeEventListener("designer:toggle-elements-panel", preventSecondPanel, { capture: true });
  };
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

function getBatchItems(job: PrintJob, template?: unknown) {
  return job.documents.map((_, index) => ({
    variables: template
      ? prepareTemplateForOutput(template, getDocumentVariables(job, index)).variables
      : getDocumentVariables(job, index),
  }));
}

function hasOutputTemplateChanges(original: unknown, prepared: unknown): boolean {
  try {
    return JSON.stringify(original) !== JSON.stringify(prepared);
  } catch {
    return true;
  }
}

async function withResolvedOutputTemplate<T>(
  designer: DesignerElement,
  values: Record<string, unknown>,
  render: () => Promise<T>,
): Promise<T> {
  const getTemplateData = designer.getTemplateData;
  const loadTemplateData = designer.loadTemplateData;
  if (typeof getTemplateData !== "function" || typeof loadTemplateData !== "function") {
    await designer.setVariables(values);
    return render();
  }

  const originalRuntimeTemplate = getTemplateData.call(designer);
  if (!originalRuntimeTemplate || typeof originalRuntimeTemplate !== "object") {
    await designer.setVariables(values);
    return render();
  }
  const persistentTemplate = getPersistentTemplateData(designer);
  const prepared = prepareTemplateForOutput(persistentTemplate, values);
  if (!hasOutputTemplateChanges(persistentTemplate, prepared.template)) {
    await designer.setVariables(values);
    return render();
  }

  if (!loadTemplateData.call(designer, prepared.template)) {
    throw new Error("多字段输出模板无法加载");
  }
  try {
    await designer.setVariables(prepared.variables);
    return await render();
  } finally {
    if (!loadTemplateData.call(designer, originalRuntimeTemplate)) {
      throw new Error("多字段输出后无法恢复编辑模板");
    }
    await designer.setVariables(designerDataSourceStates.get(designer)?.runtimeValues ?? values);
  }
}

async function withResolvedBatchTemplate<T>(
  designer: DesignerElement,
  job: PrintJob,
  render: (items: Array<{ variables?: Record<string, unknown> }>) => Promise<T>,
): Promise<T> {
  const getTemplateData = designer.getTemplateData;
  const loadTemplateData = designer.loadTemplateData;
  if (typeof getTemplateData !== "function" || typeof loadTemplateData !== "function") {
    return render(getBatchItems(job));
  }
  const originalRuntimeTemplate = getTemplateData.call(designer);
  if (!originalRuntimeTemplate || typeof originalRuntimeTemplate !== "object") {
    return render(getBatchItems(job));
  }
  const persistentTemplate = getPersistentTemplateData(designer);
  const firstValues = getDocumentVariables(job, 0);
  const prepared = prepareTemplateForOutput(persistentTemplate, firstValues);
  if (!hasOutputTemplateChanges(persistentTemplate, prepared.template)) {
    return render(getBatchItems(job));
  }
  if (!loadTemplateData.call(designer, prepared.template)) {
    throw new Error("多字段批量输出模板无法加载");
  }
  try {
    return await render(getBatchItems(job, persistentTemplate));
  } finally {
    if (!loadTemplateData.call(designer, originalRuntimeTemplate)) {
      throw new Error("多字段批量输出后无法恢复编辑模板");
    }
    await designer.setVariables(designerDataSourceStates.get(designer)?.runtimeValues ?? firstValues);
  }
}

export type PrintPreviewResult =
  | { kind: "designer"; result: unknown }
  | { kind: "pdf"; blob: Blob };

export type RenderedPrintJob = {
  layout?: "labels" | "continuous";
  recordIds: string[];
  pages: string[];
  pageCounts: number[];
  canvasWidth: number;
  canvasHeight: number;
};

function hasDesignerLabelGrid(designer: DesignerElement): boolean {
  return typeof designer.getTemplateData === "function"
    && hasNativeLabelGrid(getPersistentTemplateData(designer));
}

function hasDesignerContinuousLayout(designer: DesignerElement): boolean {
  return typeof designer.getTemplateData === "function"
    && hasContinuousLayout(getPersistentTemplateData(designer));
}

export function isRenderedPrintJobCurrent(
  rendered: RenderedPrintJob | null,
  job: PrintJob,
  layout: "default" | "continuous" | "labels" = "default",
): boolean {
  const singleDocumentLayout = layout === "labels" || layout === "continuous";
  return Boolean(rendered
    && (rendered.layout ?? "default") === layout
    && rendered.recordIds.length === job.documents.length
    && rendered.pages.length === (singleDocumentLayout ? 1 : job.documents.length)
    && rendered.pageCounts.length === rendered.pages.length
    && rendered.recordIds.every((id, index) => id === job.documents[index]?.recordId)
    && rendered.pages.every((page) => Boolean(page.trim()))
    && rendered.pageCounts.every((count) => Number.isInteger(count) && count > 0));
}

async function withNativeContinuousTemplate<T>(
  designer: DesignerElement,
  job: PrintJob,
  render: (size: { width: number; height: number }) => Promise<T>,
): Promise<T> {
  requireDocuments(job);
  const original = designer.getTemplateData();
  const layout = prepareContinuousLayout(getPersistentTemplateData(designer), job);
  if (!designer.loadTemplateData(layout.template)) throw new Error("连续输出模板无法加载");
  try {
    await designer.setVariables(layout.variables);
    return await render({ width: layout.canvasWidth, height: layout.canvasHeight });
  } finally {
    if (!designer.loadTemplateData(original)) throw new Error("连续输出后无法恢复编辑模板");
    await designer.setVariables(designerDataSourceStates.get(designer)?.runtimeValues
      ?? getDocumentVariables(job, 0));
  }
}

export async function renderContinuousPrintJobPages(
  designer: DesignerElement,
  job: PrintJob,
): Promise<RenderedPrintJob> {
  return withNativeContinuousTemplate(designer, job, async (size) => {
    const html = await renderWhenVisible(() => designer.getPreviewHtml());
    if (!html.trim()) throw new Error("连续预览生成失败");
    const count = renderedPageCount(html);
    if (count !== 1) throw new Error(`连续分页不完整：预期 1 张长纸，实际 ${count} 页`);
    return {
      layout: "continuous" as const,
      recordIds: job.documents.map((document) => document.recordId),
      pages: [html],
      pageCounts: [1],
      canvasWidth: size.width,
      canvasHeight: size.height,
    };
  });
}

export async function getContinuousPrintJobPdfBlob(
  designer: DesignerElement,
  job: PrintJob,
): Promise<Blob> {
  const blob = await withNativeContinuousTemplate(designer, job,
    () => designer.export({ type: "pdfBlob" }));
  if (!(blob instanceof Blob)) throw new Error("连续 PDF 生成失败");
  return blob;
}

async function withNativeLabelTemplate<T>(
  designer: DesignerElement,
  job: PrintJob,
  render: (pageCount: number, size: { width: number; height: number }) => Promise<T>,
): Promise<T> {
  requireDocuments(job);
  const original = designer.getTemplateData();
  const layout = prepareLabelLayout(getPersistentTemplateData(designer), job);
  if (!designer.loadTemplateData(layout.template)) throw new Error("标签输出模板无法加载");
  try {
    await designer.setVariables(layout.variables);
    return await render(layout.pageCount, { width: layout.canvasWidth, height: layout.canvasHeight });
  } finally {
    if (!designer.loadTemplateData(original)) throw new Error("标签输出后无法恢复编辑模板");
    await designer.setVariables(designerDataSourceStates.get(designer)?.runtimeValues
      ?? getDocumentVariables(job, 0));
  }
}

export async function renderLabelPrintJobPages(
  designer: DesignerElement,
  job: PrintJob,
): Promise<RenderedPrintJob> {
  return withNativeLabelTemplate(designer, job, async (expectedPages, size) => {
    const html = await renderWhenVisible(() => designer.getPreviewHtml());
    if (!html.trim()) throw new Error("标签预览生成失败");
    const count = renderedPageCount(html);
    if (count !== expectedPages) {
      throw new Error(`标签分页不完整：预期 ${expectedPages} 页，实际 ${count} 页`);
    }
    return {
      layout: "labels" as const,
      recordIds: job.documents.map((document) => document.recordId),
      pages: [html],
      pageCounts: [count],
      canvasWidth: size.width,
      canvasHeight: size.height,
    };
  });
}

export async function getLabelPrintJobPdfBlob(
  designer: DesignerElement,
  job: PrintJob,
): Promise<Blob> {
  const blob = await withNativeLabelTemplate(designer, job,
    () => designer.export({ type: "pdfBlob" }));
  if (!(blob instanceof Blob)) throw new Error("标签 PDF 生成失败");
  return blob;
}

export async function restorePrintJobVariables(designer: DesignerElement, job: PrintJob) {
  requireDocuments(job);
  const values = getDocumentVariables(job, 0);
  const state = designerDataSourceStates.get(designer);
  if (!state) {
    await designer.setVariables(values);
    return;
  }
  const persistent = getPersistentTemplateData(designer);
  state.values = values;
  toRuntimeTemplate(persistent, state);
  await designer.setTestData(state.runtimeValues);
  await designer.setVariables(state.runtimeValues);
}

export async function getPrintPreviewHtml(
  designer: DesignerElement,
  job: PrintJob,
  index = 0,
): Promise<string> {
  requireDocuments(job);
  if (!Number.isInteger(index) || index < 0 || index >= job.documents.length) {
    throw new Error("打印预览记录不存在");
  }
  const html = await withResolvedOutputTemplate(
    designer,
    getDocumentVariables(job, index),
    () => renderWhenVisible(() => designer.getPreviewHtml()),
  );
  if (!html.trim()) throw new Error("打印页面生成失败");
  return html;
}

export async function renderPrintJobPages(
  designer: DesignerElement,
  job: PrintJob,
  onProgress?: (current: number, total: number) => void,
  isCurrent: () => boolean = () => true,
): Promise<RenderedPrintJob> {
  requireDocuments(job);
  if (hasDesignerLabelGrid(designer)) {
    if (!isCurrent()) throw new Error("当前记录已切换，候选预览已取消");
    const rendered = await renderLabelPrintJobPages(designer, job);
    if (!isCurrent()) throw new Error("当前记录已切换，候选预览已取消");
    onProgress?.(job.documents.length, job.documents.length);
    return rendered;
  }
  if (hasDesignerContinuousLayout(designer)) {
    if (!isCurrent()) throw new Error("当前记录已切换，候选预览已取消");
    const rendered = await renderContinuousPrintJobPages(designer, job);
    if (!isCurrent()) throw new Error("当前记录已切换，候选预览已取消");
    onProgress?.(job.documents.length, job.documents.length);
    return rendered;
  }
  const pages: string[] = [];
  try {
    for (let index = 0; index < job.documents.length; index += 1) {
      if (!isCurrent()) throw new Error("当前记录已切换，候选预览已取消");
      pages.push(await getPrintPreviewHtml(designer, job, index));
      if (!isCurrent()) throw new Error("当前记录已切换，候选预览已取消");
      onProgress?.(index + 1, job.documents.length);
    }
  } finally {
    if (job.documents.length > 1 && isCurrent()) {
      await restorePrintJobVariables(designer, job);
    }
  }
  const template = typeof designer.getTemplateData === "function" ? designer.getTemplateData() : null;
  const size = template && typeof template === "object" && !Array.isArray(template)
    ? (template as { canvasSize?: { width?: number; height?: number } }).canvasSize
    : undefined;
  return {
    recordIds: job.documents.map((document) => document.recordId),
    pages,
    pageCounts: pages.map(renderedPageCount),
    canvasWidth: Number(size?.width) || 794,
    canvasHeight: Number(size?.height) || 1123,
  };
}

export async function renderPrintJobCandidate(
  designer: DesignerElement,
  committed: PrintJob,
  candidate: PrintJob,
  onProgress?: (current: number, total: number) => void,
  isCurrent: () => boolean = () => true,
): Promise<RenderedPrintJob> {
  try {
    const rendered = await renderPrintJobPages(designer, candidate, onProgress, isCurrent);
    if (!isCurrent()) throw new Error("当前记录已切换，候选预览已取消");
    await restorePrintJobVariables(designer, candidate);
    return rendered;
  } catch (cause) {
    if (!isCurrent()) throw cause;
    try {
      await restorePrintJobVariables(designer, committed);
    } catch (restoreCause) {
      const detail = restoreCause instanceof Error ? restoreCause.message : String(restoreCause);
      throw new Error(`候选预览失败，原记录变量也无法恢复：${detail}`);
    }
    throw cause;
  }
}

export function composeRenderedPrintPages(rendered: RenderedPrintJob): string {
  const documents = rendered.pages.map((html) => extractEnginePages(html));
  const pageMarkup = documents.flatMap(({ pages }, index) =>
    pages.length > 0 ? pages : [rendered.pages[index]],
  );
  const resources = documents.flatMap(({ resources }) => resources);
  const lastPageIndex = pageMarkup.length - 1;
  const pages = pageMarkup.map((page, index) =>
    `<section class="duowei-print-document" data-duowei-print-page="true"${index === lastPageIndex ? " data-duowei-print-page-last=\"true\"" : ""}>${page}</section>`)
    .join("");
  return resources.join("") + pages;
}

function renderedPageCount(html: string): number {
  return extractEnginePages(html).pageCount;
}

function extractEnginePages(html: string): { resources: string[]; pages: string[]; pageCount: number } {
  if (typeof DOMParser === "undefined") return { resources: [], pages: [html], pageCount: 1 };
  const document = new DOMParser().parseFromString(html, "text/html");
  const root = document.body.firstElementChild;
  const children = Array.from(root?.children ?? []);
  const resources: string[] = [];
  const pages: string[] = [];
  for (const child of children) {
    const markup = elementMarkup(child);
    if (["STYLE", "LINK", "SCRIPT"].includes(child.tagName)) {
      if (markup) resources.push(markup);
    } else {
      if (markup) pages.push(markup);
    }
  }
  const pageCount = children.filter((child) =>
    !["STYLE", "LINK", "SCRIPT"].includes(child.tagName)).length;
  if (pageCount === 0) throw new Error("打印页面没有实际分页");
  return { resources, pages, pageCount };
}

function elementMarkup(element: Element): string {
  if (typeof element.outerHTML === "string") return element.outerHTML;
  const clone = typeof (element as Element & { cloneNode?: (deep?: boolean) => Node }).cloneNode === "function"
    ? (element as Element & { cloneNode: (deep?: boolean) => Node }).cloneNode(true)
    : null;
  return clone && typeof (clone as Element).outerHTML === "string"
    ? (clone as Element).outerHTML
    : "";
}

export function renderedPreviewHeight(rendered: RenderedPrintJob): number {
  const pageCount = rendered.pageCounts.reduce((sum, count) => sum + count, 0);
  return Math.max(320, pageCount * rendered.canvasHeight + Math.max(0, pageCount - 1) * 20 + 32);
}

export async function previewPrintJob(
  designer: DesignerElement,
  job: PrintJob,
): Promise<PrintPreviewResult> {
  requireDocuments(job);
  if (job.documents.length === 1) {
    const result = await withResolvedOutputTemplate(
      designer,
      getDocumentVariables(job, 0),
      () => designer.preview(),
    );
    return { kind: "designer", result };
  }
  const blob = await withResolvedBatchTemplate(
    designer,
    job,
    (items) => renderWhenVisible(() => designer.getBatchPdfBlob(
      items,
      { filename: "duowei-print-preview.pdf" },
    )),
  );
  if (!blob) throw new Error("批量预览 PDF 生成失败");
  return { kind: "pdf", blob };
}

export async function printRenderedPages(rendered: RenderedPrintJob) {
  const singleDocumentLayout = rendered.layout === "labels" || rendered.layout === "continuous";
  if (!rendered.pages.length || rendered.pages.length !== (singleDocumentLayout ? 1 : rendered.recordIds.length)
      || rendered.pageCounts.length !== rendered.pages.length
      || rendered.pages.some((page) => !page.trim())
      || rendered.pageCounts.some((count) => !Number.isInteger(count) || count < 1)) {
    throw new Error("打印页面生成失败");
  }
  return printHtmlInCurrentDocument(rendered);
}

export async function printPrintJob(
  designer: DesignerElement,
  job: PrintJob,
  rendered?: RenderedPrintJob,
) {
  return printRenderedPages(rendered ?? await renderPrintJobPages(designer, job));
}

let releasePreviousPrint: (() => void) | undefined;

async function printHtmlInCurrentDocument(rendered: RenderedPrintJob) {
  if (typeof document === "undefined" || typeof window === "undefined" ||
      typeof window.print !== "function" || !document.body) {
    throw new Error("当前浏览器不支持页面打印");
  }
  releasePreviousPrint?.();
  const root = document.createElement("div");
  root.id = "duowei-print-root";
  root.innerHTML = `<style>@page{size:${rendered.canvasWidth}px ${rendered.canvasHeight}px;margin:0}</style>`
    + composeRenderedPrintPages(rendered);
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

function normalizePdfFilename(filename: string) {
  const value = filename.trim() || "duowei-print.pdf";
  return value.toLowerCase().endsWith(".pdf") ? value : `${value}.pdf`;
}

async function inspectPdfBlob(blob: Blob, filename: string): Promise<PdfExportResult> {
  if (blob.size < 8) throw new Error("PDF 文件无效：内容为空");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, 8));
  if (!header.startsWith("%PDF-")) throw new Error("PDF 文件无效：缺少 PDF 文件头");
  const source = new TextDecoder("latin1").decode(bytes);
  const pages = source.match(/\/Type\s*\/Page\b/g)?.length ?? 0;
  if (pages < 1) throw new Error("PDF 文件无效：未检测到页面");
  const pageSizes: Array<{ width: number; height: number }> = [];
  const pageObjects = source.split(/\/Type\s*\/Page\b/).slice(1);
  for (const pageObject of pageObjects) {
    const mediaBox = pageObject.match(/\/MediaBox\s*\[\s*[-+]?\d*\.?\d+\s+[-+]?\d*\.?\d+\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s*\]/);
    if (!mediaBox) continue;
    const width = Number(mediaBox[1]);
    const height = Number(mediaBox[2]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      pageSizes.push({ width, height });
    }
  }
  return {
    filename: normalizePdfFilename(filename),
    bytes: blob.size,
    pages,
    ...(pageSizes.length === pages ? { pageSizes } : {}),
  };
}

function submitPdfDownload(blob: Blob, filename: string) {
  if (typeof document === "undefined" || !document.body || typeof URL === "undefined" ||
      typeof URL.createObjectURL !== "function") {
    throw new Error("当前浏览器不支持 PDF 下载");
  }
  const url = URL.createObjectURL(blob);
  const revokeObjectUrl = URL.revokeObjectURL.bind(URL);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    const timer = setTimeout(() => revokeObjectUrl(url), 60000);
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  }
}

export async function exportPrintJob(
  designer: DesignerElement,
  job: PrintJob,
  filename = "duowei-print.pdf",
): Promise<PdfExportResult> {
  requireDocuments(job);
  let blob: Blob | null;
  if (hasDesignerLabelGrid(designer)) {
    blob = await getLabelPrintJobPdfBlob(designer, job);
  } else if (hasDesignerContinuousLayout(designer)) {
    blob = await getContinuousPrintJobPdfBlob(designer, job);
  } else if (job.documents.length === 1) {
    const result = await withResolvedOutputTemplate(
      designer,
      getDocumentVariables(job, 0),
      () => designer.export({ type: "pdfBlob" }),
    );
    blob = result instanceof Blob ? result : null;
  } else {
    blob = await withResolvedBatchTemplate(
      designer,
      job,
      (items) => designer.getBatchPdfBlob(items, { filename }),
    );
  }
  if (!blob) throw new Error("PDF 生成失败");
  const result = await inspectPdfBlob(blob, filename);
  submitPdfDownload(blob, result.filename);
  return result;
}
