<script setup lang="ts">
import { bitable } from "@lark-base-open/js-sdk";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import {
  bindPrintJob,
  bindStoredTemplateOrFallback,
  composeRenderedPrintPages,
  exportPrintJob,
  getPersistentTemplateData,
  installDataSourceEditingLifecycle,
  installDesignerPrintInterception,
  installDesignerSaveInterception,
  installDesignerWorkspaceChrome,
  installDesignerTemplatePanelSuppression,
  installDataSourceTerminology,
  isRenderedPrintJobCurrent,
  renderPrintJobPages,
  renderPrintJobCandidate,
  renderedPreviewHeight,
  printRenderedPages,
  rememberCopiedDataSource,
  type DesignerElement,
} from "./engine/designer-adapter.ts";
import {
  getActiveSelection,
  getCurrentRecordIds,
  sameContext,
  selectRecordIds,
  type FeishuSelection,
} from "./host/feishu-context.ts";
import { loadPrintJob } from "./host/bitable-gateway.ts";
import { templateRepository } from "./host/template-storage.ts";
import type { PrintJob } from "./core/print-job.ts";
import { generateContinuousTemplate, generateLabelTemplate } from "./core/template-generator.ts";
import { hasNativeLabelGrid } from "./core/label-layout.ts";
import { hasContinuousLayout } from "./core/continuous-layout.ts";
import {
  MAX_BATCH_RECORDS,
  createSinglePrintSession,
  type BatchPrintSession,
} from "./core/batch-print-session.ts";
import { prepareBatchCandidate } from "./core/batch-candidate-transaction.ts";
import type { RenderedPrintJob } from "./engine/designer-adapter.ts";
import {
  buildDataSourceClipboardPayload,
  fieldDataSourceId,
  SYSTEM_PRINT_DATE_ID,
} from "./core/data-sources.ts";
import type { StoredTemplate, TemplateCollection } from "./core/template-repository.ts";
import { BatchStatus } from "./components/batch-status.ts";
import {
  getBatchReadFailureFeedback,
} from "./components/batch-read-feedback.ts";
import { getBatchWorkspaceActionState } from "./components/batch-workspace-action-state.ts";
import {
  canEnterTemplateEdit,
  contextDecisionCancelStatus,
  EDITOR_PANELS,
  getTemplateDirtyState,
  getTemplateStatus,
  getWorkspaceSurface,
  initialWorkspaceMode,
  modeAfterDiscardForLoadRequest,
  shouldIgnorePendingSelectionChange,
  shouldGuardUnsavedNavigation,
  toggleWorkspaceMode,
  type EditorPanel,
  type TemplateStatus,
  type WorkspaceMode,
} from "./core/workspace.ts";

const designerRef = ref<DesignerElement | null>(null);
const selection = ref<FeishuSelection | null>(null);
const printJob = ref<PrintJob | null>(null);
const templateChecksum = ref<string | null>(null);
const storedTemplate = ref<StoredTemplate | null>(null);
const templateCollection = ref<TemplateCollection>({ templates: [], defaultId: null, revision: null });
const draftTemplateId = ref<string | null>(null);
const draftTemplateName = ref("");
const draftOriginId = ref<string | null>(null);
const templateFallback = ref(false);
const templateLoaded = ref(false);
const templateSaveAllowed = ref(false);
const templateDirty = ref(false);
const selectedTemplateId = ref<string | null>(null);
const decisionDialog = ref<"leave" | "reload" | "context" | null>(null);
const pendingContext = ref<FeishuSelection | null>(null);
const pendingLoadRequest = ref<"current" | "batch" | "exit" | null>(null);
const workspaceMode = ref<WorkspaceMode>(initialWorkspaceMode());
const activeEditorPanel = ref<EditorPanel>("data-sources");
const previewHtml = ref("");
const previewError = ref("");
const templateWarning = ref("");
const batchRetryAvailable = ref(false);
const designerReady = ref(false);
const batchSession = ref<BatchPrintSession>(createSinglePrintSession(null));
const renderedPages = ref<RenderedPrintJob | null>(null);
const status = ref("正在读取当前记录…");
const error = ref("");
const busy = ref(false);
let contextRevision = 0;
let candidateRender: Promise<RenderedPrintJob> | null = null;
let stopSelectionWatch: (() => void) | undefined;
let stopDataSourceTerminology: (() => void) | undefined;
let stopDataSourceEditingLifecycle: (() => void) | undefined;
let stopDesignerPrintInterception: (() => void) | undefined;
let stopDesignerSaveInterception: (() => void) | undefined;
let stopDesignerWorkspaceChrome: (() => void) | undefined;
let stopDesignerTemplatePanelSuppression: (() => void) | undefined;
let stopDesignerDirtyTracking: (() => void) | undefined;
let resolveDesignerReady: (() => void) | undefined;
const readyPromise = new Promise<void>((resolve) => { resolveDesignerReady = resolve; });

const editorPanelLabels: Record<EditorPanel, string> = {
  "data-sources": "数据源",
  components: "组件",
};

const templateStatusLabels: Record<TemplateStatus, string> = {
  automatic: "自动模板",
  saved: "已保存",
  fallback: "只读回退",
  unsaved: "有未保存修改",
};

const templateStatus = computed<TemplateStatus>(() => getTemplateStatus({
  hasStoredTemplate: Boolean(storedTemplate.value) || templateFallback.value,
  canSave: templateSaveAllowed.value,
  dirty: templateDirty.value,
}));

const templateStatusLabel = computed(() => templateStatusLabels[templateStatus.value]);
const currentTemplateName = computed(() => draftTemplateId.value
  ? draftTemplateName.value
  : templateCollection.value.templates.find((item) => item.id === selectedTemplateId.value)?.name
    ?? (printJob.value?.table.name ? `${printJob.value.table.name} · 自动模板` : "自动模板"));
const templateSelected = computed(() => templateLoaded.value && Boolean(selectedTemplateId.value));
const fieldDataSources = computed(() => printJob.value?.table.fields ?? []);
const batchWorkspaceActions = computed(() => getBatchWorkspaceActionState({
  busy: busy.value,
  retryAvailable: batchRetryAvailable.value,
  workspaceMode: workspaceMode.value,
  templateLoaded: templateLoaded.value,
  hasRenderedPages: Boolean(renderedPages.value),
  session: batchSession.value,
}));
const renderedLayoutLabel = computed(() => renderedPages.value?.layout === "labels"
  ? "标签排版"
  : renderedPages.value?.layout === "continuous" ? "连续排版" : "默认排版");
const currentRecordLabel = computed(() => {
  return batchSession.value.mode === "batch"
    ? `已选 ${batchSession.value.committedRecordIds.length} 条`
    : "当前记录";
});
const isBatchMode = computed(() => batchWorkspaceActions.value.isBatchMode);
const workspaceSurface = computed(() => getWorkspaceSurface(workspaceMode.value, isBatchMode.value));
const showBatchRetry = computed(() => batchWorkspaceActions.value.retryVisible);
const previewFrameHeight = computed(() => `${renderedPages.value ? renderedPreviewHeight(renderedPages.value) : 1040}px`);

async function waitForDesignerReady() {
  if (designerReady.value) return;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      readyPromise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("打印设计器初始化超时")), 15000);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function invalidateContext() {
  contextRevision += 1;
  selection.value = null;
  printJob.value = null;
  templateChecksum.value = null;
  storedTemplate.value = null;
  templateCollection.value = { templates: [], defaultId: null, revision: null };
  draftTemplateId.value = null;
  draftTemplateName.value = "";
  draftOriginId.value = null;
  templateFallback.value = false;
  templateLoaded.value = false;
  templateSaveAllowed.value = false;
  templateDirty.value = false;
  selectedTemplateId.value = null;
  decisionDialog.value = null;
  pendingContext.value = null;
  pendingLoadRequest.value = null;
  previewHtml.value = "";
  previewError.value = "";
  templateWarning.value = "";
  batchRetryAvailable.value = false;
  workspaceMode.value = initialWorkspaceMode();
  batchSession.value = createSinglePrintSession(null);
  renderedPages.value = null;
  status.value = "当前记录已切换，请重新读取";
}

async function assertCurrentContext(expected: FeishuSelection, revision: number) {
  if (revision !== contextRevision || !sameContext(expected, await getActiveSelection())) {
    throw new Error("当前记录、数据表或视图已切换，请重新读取");
  }
}

async function loadRecords(useBatchPicker = false) {
  if (useBatchPicker) {
    await loadBatchCandidate();
    return;
  }
  const revision = ++contextRevision;
  busy.value = true;
  error.value = "";
  batchRetryAvailable.value = false;
  if (!useBatchPicker) {
    selection.value = null;
    printJob.value = null;
    templateChecksum.value = null;
    storedTemplate.value = null;
    templateCollection.value = { templates: [], defaultId: null, revision: null };
    draftTemplateId.value = null;
    draftTemplateName.value = "";
    draftOriginId.value = null;
    templateFallback.value = false;
    templateLoaded.value = false;
    templateSaveAllowed.value = false;
    templateDirty.value = false;
    selectedTemplateId.value = null;
    decisionDialog.value = null;
    pendingContext.value = null;
    pendingLoadRequest.value = null;
    previewHtml.value = "";
    previewError.value = "";
    templateWarning.value = "";
    workspaceMode.value = initialWorkspaceMode();
    renderedPages.value = null;
  }
  try {
    const active = await getActiveSelection();
    selection.value = active;
    const ids = getCurrentRecordIds(active);
    await assertCurrentContext(active, revision);
    if (!ids.length) {
      status.value = "当前不是有效的记录视图，请从多维表格记录详情打开多维打印";
      return;
    }
    const job = await loadPrintJob(active, ids);
    await assertCurrentContext(active, revision);
    batchSession.value = createSinglePrintSession(active.recordId);
    selection.value = active;
    printJob.value = job;
    status.value = "已加载 " + printJob.value.documents.length + " 条记录";
    await nextTick();
    await waitForDesignerReady();
    if (candidateRender) await candidateRender.catch(() => undefined);
    await assertCurrentContext(active, revision);
    await loadTemplateAndPreview(job, active, revision);
  } catch (cause) {
    if (revision === contextRevision) {
      error.value = cause instanceof Error ? cause.message : "读取飞书数据失败";
      status.value = "加载失败";
    }
  } finally {
    if (revision === contextRevision) busy.value = false;
  }
}

async function loadBatchCandidate() {
  const revision = ++contextRevision;
  const previous = printJob.value;
  const designer = designerRef.value;
  let pending: Promise<RenderedPrintJob> | null = null;
  busy.value = true;
  error.value = "";
  batchRetryAvailable.value = false;
  try {
    if (!designer || !previous || !templateLoaded.value) throw new Error("请先等待当前记录和模板加载完成");
    const active = await getActiveSelection();
    await assertCurrentContext(active, revision);
    const ids = await selectRecordIds(active);
    await assertCurrentContext(active, revision);
    if (!ids.length) {
      status.value = "未更改打印记录";
      return;
    }
    if (ids.length > MAX_BATCH_RECORDS) {
      throw new Error(`一次最多选择 ${MAX_BATCH_RECORDS} 条记录；未更改当前打印批次`);
    }
    const candidate = await prepareBatchCandidate({
      currentSession: batchSession.value,
      loadJob: () => loadPrintJob(active, ids),
      assertCurrent: () => assertCurrentContext(active, revision),
      renderJob: (job) => {
        pending = renderPrintJobCandidate(
          designer, previous, job,
          (current, total) => { status.value = `正在生成批次预览 ${current}/${total}`; },
          () => revision === contextRevision,
        );
        candidateRender = pending;
        return pending;
      },
      composeRendered: composeRenderedPrintPages,
    });
    selection.value = active;
    printJob.value = candidate.job;
    batchSession.value = candidate.session;
    renderedPages.value = candidate.rendered;
    previewHtml.value = candidate.previewHtml;
    previewError.value = "";
    workspaceMode.value = "preview";
    status.value = `已选 ${ids.length} 条，批次预览已生成`;
  } catch (cause) {
    if (revision === contextRevision) {
      const feedback = getBatchReadFailureFeedback(cause);
      batchRetryAvailable.value = feedback.retryAvailable;
      error.value = feedback.error;
      status.value = feedback.status;
    }
  } finally {
    if (candidateRender === pending) candidateRender = null;
    if (revision === contextRevision) busy.value = false;
  }
}

async function exitBatchMode() {
  if (!isBatchMode.value || busy.value) return;
  const revision = ++contextRevision;
  const designer = designerRef.value;
  const previous = printJob.value;
  let pending: Promise<RenderedPrintJob> | null = null;
  busy.value = true;
  error.value = "";
  batchRetryAvailable.value = false;
  try {
    if (!designer || !previous) return;
    const active = await getActiveSelection();
    const ids = getCurrentRecordIds(active);
    if (!ids.length) throw new Error("当前宿主记录不可用；原批次已保留");
    const job = await loadPrintJob(active, ids);
    await assertCurrentContext(active, revision);
    pending = renderPrintJobCandidate(designer, previous, job, undefined,
      () => revision === contextRevision);
    candidateRender = pending;
    const rendered = await pending;
    await assertCurrentContext(active, revision);
    selection.value = active;
    printJob.value = job;
    batchSession.value = createSinglePrintSession(active.recordId);
    renderedPages.value = rendered;
    previewHtml.value = composeRenderedPrintPages(rendered);
    previewError.value = "";
    workspaceMode.value = "preview";
    status.value = "已返回当前记录";
  } catch (cause) {
    if (revision === contextRevision) {
      error.value = cause instanceof Error ? cause.message : "返回当前记录失败；原批次已保留";
      status.value = "原批次已保留";
    }
  } finally {
    if (candidateRender === pending) candidateRender = null;
    if (revision === contextRevision) busy.value = false;
  }
}

async function loadTemplateAndPreview(
  job = printJob.value,
  active = selection.value,
  revision = contextRevision,
  requestedId?: string | null,
): Promise<boolean> {
  if (!designerRef.value || !job || !active) return false;
  busy.value = true;
  error.value = "";
  try {
    let collection: TemplateCollection = { templates: [], defaultId: null, revision: null };
    let warning: string | null = null;
    try {
      collection = await templateRepository.list({ baseId: active.baseId, tableId: active.tableId });
    } catch (cause) {
      warning = cause instanceof Error ? cause.message : "模板集合读取失败";
    }
    const id = requestedId === undefined ? collection.defaultId : requestedId;
    const stored = collection.templates.find((item) => item.id === id) ?? null;
    if (id && id !== "automatic" && !stored) throw new Error("所选模板已不存在，请重新加载");
    await assertCurrentContext(active, revision);
    const bindWarning = await bindStoredTemplateOrFallback(designerRef.value, stored?.template, job);
    await assertCurrentContext(active, revision);
    warning ??= bindWarning;
    templateCollection.value = collection;
    storedTemplate.value = warning ? null : stored;
    selectedTemplateId.value = warning ? "automatic" : stored?.id ?? "automatic";
    draftTemplateId.value = null;
    draftOriginId.value = null;
    templateFallback.value = Boolean(warning);
    templateChecksum.value = warning ? null : stored?.checksum ?? null;
    templateLoaded.value = true;
    templateSaveAllowed.value = !warning;
    templateDirty.value = false;
    captureTemplateBaseline();
    templateWarning.value = warning
      ? `${warning}；原模板未覆盖，已改用自动模板并绑定真实数据`
      : "";
    renderedPages.value = null;
    previewHtml.value = "";
    if (warning) {
      status.value = "已加载当前记录和动态数据源；旧模板暂不可保存";
    } else {
      status.value = stored
        ? "已加载所选模板并绑定真实数据"
        : "已自动生成模板并绑定真实数据";
    }
    previewHtml.value = "";
    previewError.value = "";
    try {
      const rendered = await renderPrintJobPages(designerRef.value, job);
      await assertCurrentContext(active, revision);
      renderedPages.value = rendered;
      previewHtml.value = composeRenderedPrintPages(rendered);
    } catch (cause) {
      if (revision !== contextRevision) return false;
      previewError.value = cause instanceof Error ? cause.message : "打印预览生成失败";
      status.value = "模板已加载，预览生成失败";
    }
    return true;
  } catch (cause) {
    if (revision === contextRevision) {
      error.value = cause instanceof Error ? cause.message : "打印模板加载失败";
      status.value = "模板加载失败";
    }
    return false;
  } finally {
    if (revision === contextRevision) busy.value = false;
  }
}

let templateBaseline = "";

function readTemplateSnapshot() {
  if (!designerRef.value) return "";
  try {
    return JSON.stringify(getPersistentTemplateData(designerRef.value));
  } catch {
    return "";
  }
}

function captureTemplateBaseline() {
  templateBaseline = readTemplateSnapshot();
}

function refreshTemplateDirtyState() {
  if (workspaceMode.value !== "edit") return templateDirty.value;
  templateDirty.value = getTemplateDirtyState({
    hasDraft: Boolean(draftTemplateId.value),
    baseline: templateBaseline,
    snapshot: readTemplateSnapshot(),
    dirty: templateDirty.value,
  });
  return templateDirty.value;
}

function installDesignerDirtyTracking() {
  const designer = designerRef.value;
  if (!designer) return () => undefined;
  const events = ["input", "change", "pointerup", "keyup", "click", "drop"];
  const handleInteraction = () => queueMicrotask(refreshTemplateDirtyState);
  events.forEach((eventName) => designer.addEventListener(eventName, handleInteraction));
  return () => events.forEach((eventName) => designer.removeEventListener(eventName, handleInteraction));
}

async function refreshPreview(): Promise<boolean> {
  if (!designerRef.value || !printJob.value) return false;
  const active = selection.value;
  const revision = contextRevision;
  busy.value = true;
  error.value = "";
  previewError.value = "";
  renderedPages.value = null;
  previewHtml.value = "";
  try {
    const rendered = await renderPrintJobPages(designerRef.value, printJob.value);
    if (active) await assertCurrentContext(active, revision);
    renderedPages.value = rendered;
    previewHtml.value = composeRenderedPrintPages(rendered);
    status.value = "打印预览已刷新";
    return true;
  } catch (cause) {
    if (revision === contextRevision) {
      previewError.value = cause instanceof Error ? cause.message : "打印预览生成失败";
      previewHtml.value = "";
      status.value = "预览失败";
    }
    return false;
  } finally {
    if (revision === contextRevision) busy.value = false;
  }
}

function markDesignerReady() {
  designerReady.value = true;
  stopDataSourceTerminology?.();
  stopDataSourceEditingLifecycle?.();
  stopDesignerTemplatePanelSuppression?.();
  stopDesignerWorkspaceChrome?.();
  if (designerRef.value) {
    stopDataSourceTerminology = installDataSourceTerminology(designerRef.value);
    stopDataSourceEditingLifecycle = installDataSourceEditingLifecycle(designerRef.value, {
      onChange: refreshTemplateDirtyState,
      onError: (cause) => {
        error.value = cause.message;
        status.value = "数据源内容未能同步";
      },
    });
    stopDesignerTemplatePanelSuppression = installDesignerTemplatePanelSuppression(window);
    stopDesignerWorkspaceChrome = installDesignerWorkspaceChrome(designerRef.value, window);
    stopDesignerDirtyTracking?.();
    stopDesignerDirtyTracking = installDesignerDirtyTracking();
  }
  resolveDesignerReady?.();
}

function handleDesignerLoadError(event: Event) {
  const cause = (event as CustomEvent<unknown>).detail;
  error.value = cause instanceof Error ? cause.message : "打印设计器资源加载失败";
  status.value = "打印设计器初始化失败，请检查网络后重开插件";
}

async function previewOutput() {
  if (!designerRef.value || !printJob.value || !templateLoaded.value || !selection.value) return;
  await refreshPreview();
}

async function saveTemplate(options: { returnToPreview?: boolean; allowContextChange?: boolean } = {}): Promise<boolean> {
  if (isBatchMode.value || !designerRef.value || !selection.value || !templateSaveAllowed.value) return false;
  const active = selection.value;
  const revision = contextRevision;
  busy.value = true;
  error.value = "";
  try {
    if (!options.allowContextChange) await assertCurrentContext(active, revision);
    const id = draftTemplateId.value ?? (selectedTemplateId.value === "automatic"
      ? crypto.randomUUID() : selectedTemplateId.value);
    if (!id) throw new Error("请先选择模板");
    const updated = await templateRepository.upsert(
      { baseId: active.baseId, tableId: active.tableId },
      getPersistentTemplateData(designerRef.value),
      { id, name: currentTemplateName.value, expectedRevision: templateCollection.value.revision },
    );
    if (!options.allowContextChange) await assertCurrentContext(active, revision);
    const saved = updated.templates.find((item) => item.id === id)!;
    templateCollection.value = updated;
    selectedTemplateId.value = id;
    draftTemplateId.value = null;
    draftOriginId.value = null;
    templateChecksum.value = saved.checksum;
    storedTemplate.value = saved;
    templateFallback.value = false;
    templateDirty.value = false;
    captureTemplateBaseline();
    status.value = "模板已保存（未写入当前记录值）";
    if (options.returnToPreview) {
      workspaceMode.value = "preview";
    }
    return true;
  } catch (cause) {
    if (revision === contextRevision) {
      error.value = cause instanceof Error ? cause.message : "打印模板保存失败";
      status.value = "模板未保存";
    }
    return false;
  } finally {
    busy.value = false;
  }
}

type NewTemplateKind = "default" | "continuous" | "labels";

function templateLayoutLabel(template: unknown) {
  if (hasNativeLabelGrid(template)) return "标签排版";
  if (hasContinuousLayout(template)) return "连续排版";
  return "默认排版";
}

async function createTemplate(kind: NewTemplateKind = "default") {
  if (isBatchMode.value || !designerRef.value || !printJob.value || !templateLoaded.value) return;
  busy.value = true;
  error.value = "";
  try {
    const initialTemplate = kind === "labels"
      ? generateLabelTemplate(printJob.value)
      : kind === "continuous" ? generateContinuousTemplate(printJob.value) : null;
    await bindPrintJob(designerRef.value, initialTemplate, printJob.value);
    draftOriginId.value = selectedTemplateId.value;
    draftTemplateId.value = crypto.randomUUID();
    const prefix = kind === "labels" ? "标签模板" : kind === "continuous" ? "连续模板" : "新模板";
    draftTemplateName.value = `${prefix} ${templateCollection.value.templates.length + 1}`;
    selectedTemplateId.value = draftTemplateId.value;
    templateDirty.value = true;
    renderedPages.value = null;
    previewHtml.value = "";
    workspaceMode.value = "edit";
    activeEditorPanel.value = "data-sources";
    status.value = kind === "labels" ? "已创建未保存标签模板草稿"
      : kind === "continuous" ? "已创建未保存连续模板草稿" : "已创建未保存模板草稿";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "新模板创建失败";
    status.value = "新模板创建失败";
  } finally {
    busy.value = false;
  }
}

async function selectTemplate(id: string) {
  if (isBatchMode.value || !templateLoaded.value || selectedTemplateId.value === id || !selection.value) return;
  await loadTemplateAndPreview(printJob.value, selection.value, contextRevision, id);
}

async function updateDirectory(action: "rename" | "remove" | "default", item: StoredTemplate) {
  if (isBatchMode.value || !selection.value || busy.value) return;
  const name = action === "rename" ? window.prompt("模板名称", item.name)?.trim() : null;
  if (action === "rename" && (!name || name === item.name)) return;
  if (action === "remove" && !window.confirm(`删除模板“${item.name}”？此操作不能撤销。`)) return;
  const active = selection.value;
  const revision = contextRevision;
  busy.value = true;
  error.value = "";
  try {
    await assertCurrentContext(active, revision);
    const context = { baseId: active.baseId, tableId: active.tableId };
    const expected = templateCollection.value.revision;
    const updated = action === "rename"
      ? await templateRepository.rename(context, item.id, name!, expected)
      : action === "remove"
        ? await templateRepository.remove(context, item.id, expected)
        : await templateRepository.setDefault(context, item.id, expected);
    await assertCurrentContext(active, revision);
    templateCollection.value = updated;
    status.value = action === "rename" ? "模板已重命名" : action === "remove" ? "模板已删除" : "默认模板已更新";
    if (action === "remove" && selectedTemplateId.value === item.id) {
      await loadTemplateAndPreview(printJob.value, active, revision, updated.defaultId);
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "模板目录操作失败";
  } finally {
    busy.value = false;
  }
}

function enterEditMode() {
  if (isBatchMode.value) {
    status.value = "批量预览期间不能编辑模板，请先退出批量";
    return;
  }
  if (!canEnterTemplateEdit({
    templateLoaded: templateLoaded.value,
    templateSelected: templateSelected.value,
  })) {
    status.value = "请先在模板目录中选择模板";
    return;
  }
  workspaceMode.value = "edit";
  renderedPages.value = null;
  previewHtml.value = "";
  activeEditorPanel.value = "data-sources";
  status.value = "已进入编辑模式";
}

async function applyPreviewMode(): Promise<boolean> {
  const refreshed = await refreshPreview();
  if (refreshed && workspaceMode.value === "edit") {
    workspaceMode.value = toggleWorkspaceMode(workspaceMode.value);
  }
  return refreshed;
}

function requestPreviewMode() {
  if (workspaceMode.value !== "edit") {
    void refreshPreview();
    return;
  }
  if (shouldGuardUnsavedNavigation(refreshTemplateDirtyState())) {
    decisionDialog.value = "leave";
    return;
  }
  void applyPreviewMode();
}

function requestTemplateReload() {
  if (shouldGuardUnsavedNavigation(refreshTemplateDirtyState())) {
    decisionDialog.value = "reload";
    return;
  }
  void loadTemplateAndPreview(printJob.value, selection.value, contextRevision,
    selectedTemplateId.value === "automatic" ? null : selectedTemplateId.value);
}

function requestLoadRecords(useBatchPicker = false) {
  if (shouldGuardUnsavedNavigation(refreshTemplateDirtyState())) {
    pendingContext.value = null;
    pendingLoadRequest.value = useBatchPicker ? "batch" : "current";
    decisionDialog.value = "context";
    return;
  }
  void loadRecords(useBatchPicker);
}

function requestExitBatch() {
  if (!isBatchMode.value) return;
  if (shouldGuardUnsavedNavigation(refreshTemplateDirtyState())) {
    pendingLoadRequest.value = "exit";
    decisionDialog.value = "context";
    return;
  }
  void exitBatchMode();
}

async function resolveDecision(decision: "save" | "discard" | "cancel") {
  const action = decisionDialog.value;
  decisionDialog.value = null;
  if (!action || decision === "cancel") {
    if (decision === "cancel") {
      if (action === "context") {
        status.value = contextDecisionCancelStatus(pendingLoadRequest.value);
      }
      pendingContext.value = null;
      pendingLoadRequest.value = null;
    }
    return;
  }
  if (action === "context") {
    const request = pendingLoadRequest.value;
    if (decision === "save") {
      const saved = await saveTemplate({ allowContextChange: true });
      if (!saved) return;
      if (request === "batch" && !await applyPreviewMode()) return;
    } else if (request === "batch" || request === "exit") {
      const loaded = await loadTemplateAndPreview(printJob.value, selection.value, contextRevision,
        draftOriginId.value ?? (selectedTemplateId.value === "automatic" ? null : selectedTemplateId.value));
      if (!loaded) return;
      if (request === "batch" && !renderedPages.value) return;
      workspaceMode.value = modeAfterDiscardForLoadRequest(request, workspaceMode.value);
    }
    pendingContext.value = null;
    pendingLoadRequest.value = null;
    if (request === "exit") void exitBatchMode();
    else {
      if (request !== "batch") invalidateContext();
      void loadRecords(request === "batch");
    }
    return;
  }
  if (decision === "save") {
    const saved = await saveTemplate();
    if (!saved) return;
  } else {
    const loaded = await loadTemplateAndPreview(printJob.value, selection.value, contextRevision,
      draftOriginId.value ?? (selectedTemplateId.value === "automatic" ? null : selectedTemplateId.value));
    if (!loaded) return;
  }
  if (action === "leave") await applyPreviewMode();
  else if (action === "reload" && decision === "save") {
    await loadTemplateAndPreview(printJob.value, selection.value, contextRevision, selectedTemplateId.value);
  }
}

function selectEditorPanel(panel: EditorPanel) {
  activeEditorPanel.value = panel;
}

async function writeClipboardText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the browser's synchronous clipboard path for iframe hosts.
    }
  }
  if (typeof document === "undefined" || !document.body) {
    throw new Error("当前环境不支持复制数据源");
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("浏览器拒绝复制数据源");
}

async function copyDataSource(source: { id: string; label: string }) {
  const payload = buildDataSourceClipboardPayload(source);
  error.value = "";
  try {
    await writeClipboardText(payload.text);
    if (designerRef.value) rememberCopiedDataSource(designerRef.value, payload);
    status.value = `已复制“${source.label}”，请选中文本组件后粘贴`;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "数据源复制失败";
    status.value = "数据源复制失败";
  }
}

const components = [
  { type: "text", label: "文本" },
  { type: "table", label: "表格" },
  { type: "image", label: "图片" },
  { type: "line", label: "横线" },
  { type: "rect", label: "矩形" },
] as const;

function startComponentDrag(type: string, event: DragEvent) {
  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("application/json", JSON.stringify({ type }));
}

async function printOutput() {
  if (!designerRef.value || !printJob.value || !selection.value) return;
  const active = selection.value;
  const revision = contextRevision;
  busy.value = true;
  error.value = "";
  try {
    if (workspaceMode.value !== "preview") throw new Error("请先返回预览，确认最新页面后再打印");
    await assertCurrentContext(active, revision);
    const rendered = renderedPages.value;
    if (!isRenderedPrintJobCurrent(rendered, printJob.value, rendered?.layout ?? "default")) {
      throw new Error("打印预览尚未准备好，请先刷新预览");
    }
    await printRenderedPages(rendered!);
    await assertCurrentContext(active, revision);
    status.value = "已发起浏览器打印流程，请在打印对话框确认或取消";
  } catch (cause) {
    if (revision === contextRevision) {
      error.value = cause instanceof Error ? cause.message : "浏览器打印失败";
      status.value = "打印流程未完成";
    }
  } finally {
    busy.value = false;
  }
}

async function exportPdf() {
  if (!designerRef.value || !printJob.value || !selection.value) return;
  const active = selection.value;
  const revision = contextRevision;
  busy.value = true;
  error.value = "";
  try {
    if (workspaceMode.value !== "preview" || !isRenderedPrintJobCurrent(
      renderedPages.value, printJob.value, renderedPages.value?.layout ?? "default")) {
      throw new Error("请先返回预览，确认最新页面后再导出 PDF");
    }
    await assertCurrentContext(active, revision);
    const result = await exportPrintJob(designerRef.value, printJob.value, "duowei-print.pdf");
    await assertCurrentContext(active, revision);
    const size = result.bytes >= 1024
      ? `${(result.bytes / 1024).toFixed(1)} KB`
      : `${result.bytes} B`;
    const paper = result.pageSizes?.length === result.pages
      ? result.pageSizes.every((page) => page.width === result.pageSizes![0].width
        && page.height === result.pageSizes![0].height)
        ? `；纸张 ${result.pageSizes[0].width.toFixed(1)}×${result.pageSizes[0].height.toFixed(1)} pt`
        : "；纸张尺寸多种"
      : "";
    status.value = `PDF 已生成：${result.pages} 页，${size}${paper}；已提交浏览器下载`;
  } catch (cause) {
    if (revision === contextRevision) {
      error.value = cause instanceof Error ? cause.message : "PDF 导出失败";
      status.value = "PDF 导出未完成";
    }
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  window.addEventListener("duowei-print:designer-load-error", handleDesignerLoadError);
  stopDesignerPrintInterception = installDesignerPrintInterception(window, () => {
    void printOutput();
  });
  stopDesignerSaveInterception = installDesignerSaveInterception(window, () => {
    if (workspaceMode.value === "edit") void saveTemplate();
  });
  if (designerRef.value?.isReady) markDesignerReady();
  stopSelectionWatch = bitable.base.onSelectionChange(({ data }) => {
    if (!selection.value || sameContext(selection.value, data)) return;
    if (shouldIgnorePendingSelectionChange({
      hasPendingExplicitLoad: decisionDialog.value === "context" && pendingLoadRequest.value !== null,
      current: selection.value,
      incoming: data,
    })) return;
    if (shouldGuardUnsavedNavigation(refreshTemplateDirtyState())) {
      pendingContext.value = data.baseId && data.tableId && data.viewId
        ? {
            baseId: data.baseId,
            tableId: data.tableId,
            viewId: data.viewId,
            recordId: data.recordId ?? null,
          }
        : null;
      pendingLoadRequest.value = null;
      decisionDialog.value = "context";
      status.value = "当前记录已切换，请先处理未保存的模板修改";
      return;
    }
    invalidateContext();
    void loadRecords(false);
  });
  void loadRecords(false);
});

onBeforeUnmount(() => {
  window.removeEventListener("duowei-print:designer-load-error", handleDesignerLoadError);
  stopSelectionWatch?.();
  stopDataSourceTerminology?.();
  stopDataSourceEditingLifecycle?.();
  stopDesignerDirtyTracking?.();
  stopDesignerPrintInterception?.();
  stopDesignerSaveInterception?.();
  stopDesignerWorkspaceChrome?.();
  stopDesignerTemplatePanelSuppression?.();
});
</script>

<template>
  <main class="app-shell">
    <header class="app-header">
      <div class="brand-block">
        <p class="eyebrow">飞书多维表格 · 记录视图插件</p>
        <h1>多维打印</h1>
      </div>
      <div class="header-context">
        <span>{{ printJob?.table.name || "正在读取数据表" }}</span>
        <span class="context-divider">/</span>
        <span>{{ currentRecordLabel }}</span>
      </div>
      <div class="header-actions">
        <button v-if="!isBatchMode" class="button button-quiet" :disabled="busy" @click="requestLoadRecords(false)">
          {{ busy ? "读取中…" : "重新读取" }}
        </button>
        <button class="button button-quiet" :disabled="busy || !templateLoaded" @click="requestLoadRecords(true)">
          {{ batchWorkspaceActions.selectLabel }}
        </button>
        <button v-if="isBatchMode" class="button button-quiet" :disabled="busy" @click="requestExitBatch">退出批量</button>
        <button :disabled="batchWorkspaceActions.outputDisabled" class="button button-outline" @click="printOutput">
          {{ batchWorkspaceActions.printLabel }}
        </button>
        <button :disabled="batchWorkspaceActions.outputDisabled" class="button button-outline" @click="exportPdf">
          {{ batchWorkspaceActions.exportPdfLabel }}
        </button>
      </div>
    </header>

    <BatchStatus v-if="isBatchMode" :summaries="batchWorkspaceActions.summaries"
      :layout="renderedPages?.layout ?? 'default'" />

    <div class="status-line" :class="{ 'status-line-error': error || templateWarning || previewError }">
      <span class="status-dot" aria-hidden="true"></span>
      <span>{{ status }}</span>
      <span v-if="templateWarning">模板：{{ templateWarning }}</span>
      <span v-if="previewError">预览：{{ previewError }}</span>
      <span v-if="error">{{ error }}</span>
      <button v-if="showBatchRetry" class="status-retry-button" type="button"
        @click="requestLoadRecords(true)">重试批量读取</button>
    </div>

    <section class="workspace" :class="`workspace-${workspaceMode}`">
      <aside class="sidebar" :aria-label="workspaceSurface === 'batch-preview' ? '批量预览' : workspaceSurface === 'single-preview' ? '模板目录' : '编辑操作区'">
        <div v-if="workspaceSurface === 'batch-preview'" class="sidebar-section batch-preview-sidebar">
          <div class="sidebar-title-row">
            <span class="sidebar-title">批量预览</span>
            <span class="sidebar-count">{{ batchSession.committedRecordIds.length }} 条</span>
          </div>
          <strong>{{ currentTemplateName }}</strong>
          <span class="batch-preview-sidebar-note">{{ renderedLayoutLabel }}</span>
          <span class="batch-preview-sidebar-note">当前批次只读，模板调整请先退出批量</span>
        </div>

        <div v-if="workspaceSurface === 'single-preview'" class="sidebar-section template-section">
          <div class="sidebar-title-row">
            <span class="sidebar-title">模板目录</span>
            <span class="sidebar-count">{{ templateCollection.templates.length }} 个</span>
          </div>
          <button
            v-if="!templateCollection.templates.length || selectedTemplateId === 'automatic'"
            class="template-item"
            :class="{ 'template-item-active': selectedTemplateId === 'automatic' }"
            :disabled="!templateLoaded"
            @click="selectTemplate('automatic')"
          >
            <span class="template-item-mark" aria-hidden="true"></span>
            <span class="template-item-copy">
              <strong>自动模板</strong>
              <small>{{ templateFallback ? '只读回退' : '未保存' }}</small>
            </span>
          </button>
          <div v-for="item in templateCollection.templates" :key="item.id" class="template-directory-row">
            <button class="template-item" :class="{ 'template-item-active': selectedTemplateId === item.id }"
              :disabled="busy" @click="selectTemplate(item.id)">
              <span class="template-item-mark" aria-hidden="true"></span>
              <span class="template-item-copy"><strong>{{ item.name }}</strong>
                <small>{{ templateLayoutLabel(item.template) }} · {{ item.id === templateCollection.defaultId ? '默认模板' : '已保存' }}</small></span>
            </button>
            <div class="template-item-actions">
              <button title="重命名" :disabled="busy" @click="updateDirectory('rename', item)">重命名</button>
              <button v-if="item.id !== templateCollection.defaultId" title="设为默认" :disabled="busy"
                @click="updateDirectory('default', item)">设默认</button>
              <button title="删除" :disabled="busy || (item.id === templateCollection.defaultId && templateCollection.templates.length > 1)"
                @click="updateDirectory('remove', item)">删除</button>
            </div>
          </div>
          <button
            class="button button-new-template"
            :disabled="busy || !templateLoaded || !templateSaveAllowed"
            @click="createTemplate('default')"
          >
            <span aria-hidden="true">＋</span>
            新建模板
          </button>
          <button class="button button-new-template" :disabled="busy || !templateLoaded || !templateSaveAllowed"
            @click="createTemplate('continuous')">
            <span aria-hidden="true">＋</span>
            新建连续模板
          </button>
          <button class="button button-new-template" :disabled="busy || !templateLoaded || !templateSaveAllowed"
            @click="createTemplate('labels')">
            <span aria-hidden="true">＋</span>
            新建标签模板
          </button>
        </div>

        <nav v-if="workspaceSurface === 'single-edit'" class="sidebar-section editor-nav" aria-label="编辑入口">
          <div class="sidebar-title-row">
            <span class="sidebar-title">编辑入口</span>
            <span class="sidebar-count">{{ EDITOR_PANELS.length }}</span>
          </div>
          <button
            v-for="panel in EDITOR_PANELS"
            :key="panel"
            class="editor-nav-item"
            :class="{ 'editor-nav-item-active': activeEditorPanel === panel }"
            @click="selectEditorPanel(panel)"
          >
            <span class="editor-nav-index">{{ EDITOR_PANELS.indexOf(panel) + 1 }}</span>
            <span>{{ editorPanelLabels[panel] }}</span>
          </button>
        </nav>

        <div v-if="workspaceSurface === 'single-edit' && activeEditorPanel === 'data-sources'" class="sidebar-section editor-content">
          <strong>字段</strong>
          <button v-for="field in fieldDataSources" :key="field.id" class="data-source-row" type="button"
            :aria-label="`复制数据源 ${field.name}`"
            @click="copyDataSource({ id: fieldDataSourceId(field.id), label: field.name })">
            <span>{{ field.name }}</span><small>{{ field.isLink || field.arrayColumns ? '复制 Token' : '复制' }}</small>
          </button>
          <span v-if="!fieldDataSources.length" class="empty-copy">当前表没有可用字段</span>
          <strong>系统</strong>
          <button class="data-source-row" type="button" aria-label="复制数据源 打印日期"
            @click="copyDataSource({ id: SYSTEM_PRINT_DATE_ID, label: '打印日期' })">
            <span>打印日期</span><small>复制</small>
          </button>
        </div>
        <div v-if="workspaceSurface === 'single-edit' && activeEditorPanel === 'components'" class="sidebar-section editor-content">
          <button v-for="component in components" :key="component.type" class="data-source-row component-row" draggable="true"
            @dragstart="startComponentDrag(component.type, $event)">
            <span>{{ component.label }}</span><small>拖入画布</small>
          </button>
        </div>

        <div class="sidebar-footer">
          <span class="status-chip" :class="`status-${templateStatus}`">{{ templateStatusLabel }}</span>
          <button v-if="workspaceSurface === 'single-edit'"
            class="button button-link"
            :disabled="busy || !designerReady || !printJob"
            @click="requestTemplateReload"
          >
            重新加载模板
          </button>
        </div>
      </aside>

      <section class="workspace-main">
        <header class="workspace-toolbar">
          <div>
            <p class="workspace-kicker">{{ workspaceSurface === 'batch-preview' ? '批量打印预览' : workspaceSurface === 'single-preview' ? '打印预览' : '模板编辑' }}</p>
            <h2>{{ currentTemplateName }}</h2>
          </div>
          <div class="workspace-actions">
            <template v-if="workspaceSurface === 'single-edit'">
              <span class="save-state">{{ templateStatusLabel }}</span>
              <button class="button button-quiet" :disabled="busy" @click="requestPreviewMode">
                返回预览
              </button>
              <button class="button button-primary" :disabled="busy || !templateSaveAllowed"
                @click="saveTemplate()">保存模板</button>
            </template>
            <template v-else>
              <button class="button button-quiet" :disabled="busy || !templateLoaded" @click="previewOutput">刷新预览</button>
              <button v-if="workspaceSurface === 'single-preview'" class="button button-primary" :disabled="busy || !templateSelected || !templateSaveAllowed"
                @click="enterEditMode">编辑模板</button>
            </template>
          </div>
        </header>

        <div class="canvas-stage">
          <div class="designer-host" :class="{ 'designer-host-preview': workspaceSurface !== 'single-edit' }"
            :aria-hidden="workspaceSurface === 'batch-preview' ? 'true' : 'false'"
            :inert="workspaceSurface === 'batch-preview' ? true : undefined">
            <print-designer ref="designerRef" lang="zh" @ready="markDesignerReady" />
          </div>
          <section v-if="workspaceMode === 'preview'" class="preview-surface" aria-label="打印预览">
            <div v-if="previewHtml" class="preview-paper-wrap">
              <iframe :srcdoc="previewHtml" :style="{ height: previewFrameHeight,
                width: `min(${renderedPages?.canvasWidth ?? 794}px, 100%)` }" title="打印预览" class="preview-frame" />
            </div>
            <div v-else class="preview-empty">
              <strong>{{ previewError ? '打印预览生成失败' : '正在生成打印预览' }}</strong>
              <span v-if="previewError">{{ previewError }}</span>
              <span v-else-if="!templateLoaded">读取当前记录与模板中</span>
              <span v-else>切回此标签页后，预览会继续生成</span>
              <button v-if="previewError" class="button button-outline" :disabled="busy" @click="previewOutput">重试预览</button>
            </div>
          </section>
        </div>
      </section>
    </section>

    <section
      v-if="decisionDialog"
      class="decision-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsaved-title"
    >
      <div class="decision-card">
        <h2 id="unsaved-title">模板有未保存修改</h2>
        <p v-if="decisionDialog === 'leave'">返回预览前，请先决定是否保存当前模板。</p>
        <p v-else-if="decisionDialog === 'reload'">重新加载会覆盖当前模板草稿。</p>
        <p v-else>读取其他记录或上下文前，请先处理当前模板草稿。</p>
        <div class="decision-actions">
          <button class="button button-quiet" :disabled="busy" @click="resolveDecision('cancel')">继续编辑</button>
          <button class="button button-outline" :disabled="busy" @click="resolveDecision('discard')">放弃修改</button>
          <button
            class="button button-primary"
            :disabled="busy || !templateSaveAllowed"
            @click="resolveDecision('save')"
          >
            保存并继续
          </button>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.app-shell { min-height: 100dvh; padding: 18px 22px 22px; color: #1d2733; }
.app-header { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 24px; padding-bottom: 16px; border-bottom: 1px solid #dfe4ea; }
.brand-block h1 { margin: 0; font-size: 24px; letter-spacing: 0; }
.eyebrow { margin: 0 0 6px; color: #718092; font-size: 11px; letter-spacing: .08em; }
.header-context { display: flex; align-items: center; gap: 9px; color: #647184; font-size: 13px; }
.context-divider { color: #b7c0cb; }
.header-actions, .workspace-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.button { min-height: 34px; border: 1px solid #cbd3dc; border-radius: 6px; padding: 7px 12px; background: #fff; color: #223042; font: inherit; font-size: 13px; transition: border-color .18s ease, background-color .18s ease, transform .18s ease; }
.button:hover:not(:disabled) { border-color: #8c9bab; background: #f7f9fb; }
.button:active:not(:disabled) { transform: translateY(1px); }
.button:focus-visible, .template-item:focus-visible, .editor-nav-item:focus-visible { outline: 2px solid #557da7; outline-offset: 2px; }
.button:disabled { cursor: not-allowed; opacity: .48; }
.button-primary { border-color: #2d5f91; background: #2d5f91; color: #fff; }
.button-primary:hover:not(:disabled) { border-color: #244c74; background: #244c74; }
.button-outline { border-color: #557da7; color: #2d5f91; }
.button-quiet { border-color: transparent; background: transparent; color: #526276; }
.button-edit-template, .button-new-template { width: 100%; margin-top: 10px; }
.button-new-template { border-style: dashed; color: #2d5f91; }
.button-link { min-height: 28px; border-color: transparent; padding: 4px 0; color: #2d5f91; }
.status-line { display: flex; align-items: center; gap: 8px; min-height: 34px; color: #526276; font-size: 13px; }
.status-retry-button { border: 0; padding: 0; background: transparent; color: #2d5f91; font: inherit; font-size: 13px; text-decoration: underline; cursor: pointer; }
.status-retry-button:hover { color: #244c74; }
.batch-bar { display: flex; align-items: center; gap: 12px; min-height: 38px; padding: 7px 0; color: #526276; font-size: 12px; }
.batch-bar strong { flex: 0 0 auto; color: #263749; font-size: 13px; }
.batch-bar > span:nth-child(2) { flex: 0 0 auto; border: 1px solid #cbd3dc; border-radius: 4px; padding: 3px 6px; }
.batch-summaries { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status-line-error { color: #a33a32; }
.status-dot { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: #5b8c68; }
.status-line-error .status-dot { background: #b44d45; }
.workspace { display: grid; grid-template-columns: 220px minmax(0, 1fr); min-height: calc(100dvh - 130px); overflow: hidden; border: 1px solid #dfe4ea; background: #fbfcfd; }
.sidebar { display: flex; flex-direction: column; border-right: 1px solid #dfe4ea; background: #f6f8fa; }
.sidebar-section { padding: 18px 14px; }
.batch-preview-sidebar { display: grid; gap: 10px; }
.batch-preview-sidebar > strong { color: #314356; font-size: 13px; font-weight: 650; }
.batch-preview-sidebar-note { color: #7a8796; font-size: 12px; line-height: 1.5; }
.sidebar-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.sidebar-title { color: #324254; font-size: 12px; font-weight: 650; }
.sidebar-count { color: #8995a3; font-size: 11px; }
.template-item { display: flex; width: 100%; gap: 9px; align-items: flex-start; border: 1px solid transparent; border-radius: 6px; padding: 10px 9px; background: transparent; color: inherit; text-align: left; font: inherit; }
.template-item:hover:not(:disabled), .template-item-active { border-color: #cad7e4; background: #fff; }
.template-item:disabled { cursor: default; opacity: .6; }
.template-item-mark { width: 7px; height: 7px; flex: 0 0 7px; margin-top: 5px; border-radius: 50%; background: #557da7; }
.template-item-copy { display: grid; gap: 4px; min-width: 0; }
.template-item-copy strong { overflow: hidden; color: #263749; font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.template-item-copy small { color: #7b8998; font-size: 11px; }
.sidebar-note { margin: 10px 2px 0; color: #7e8b9a; font-size: 11px; line-height: 1.55; }
.editor-nav { border-top: 1px solid #e1e6eb; }
.editor-nav-item { display: flex; width: 100%; align-items: center; gap: 9px; border: 0; border-radius: 5px; padding: 9px 8px; background: transparent; color: #536276; text-align: left; font: inherit; font-size: 13px; }
.editor-nav-item:hover { background: #e9eef3; color: #263749; }
.editor-nav-item-active { background: #e2eaf2; color: #244c74; font-weight: 600; }
.editor-nav-index { width: 18px; color: #8b98a6; font-size: 11px; font-variant-numeric: tabular-nums; }
.sidebar-footer { display: grid; gap: 8px; margin-top: auto; padding: 14px; border-top: 1px solid #e1e6eb; }
.status-chip { display: inline-flex; width: fit-content; align-items: center; border: 1px solid #c9d3de; border-radius: 4px; padding: 3px 6px; color: #566677; font-size: 11px; }
.status-saved { border-color: #b8d4c0; color: #357048; }
.status-unsaved { border-color: #e2c28e; color: #8a5a16; }
.status-fallback { border-color: #e4b6b0; color: #98453e; }
.workspace-main { display: flex; min-width: 0; flex-direction: column; }
.workspace-toolbar { display: flex; min-height: 68px; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 18px; border-bottom: 1px solid #e1e6eb; background: #fff; }
.workspace-kicker, .context-kicker { margin: 0 0 3px; color: #6b7b8c; font-size: 11px; }
.workspace-toolbar h2 { margin: 0; color: #233345; font-size: 17px; font-weight: 650; }
.save-state { color: #748293; font-size: 12px; }
.editor-context { border-bottom: 1px solid #e1e6eb; background: #f8fafc; }
.context-panel { padding: 14px 18px; }
.context-panel-compact { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.context-panel h3 { margin: 0; color: #263749; font-size: 14px; font-weight: 650; }
.context-panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.context-panel-heading > span { color: #8290a0; font-size: 11px; }
.context-hint { max-width: 66ch; margin: 12px 0 0; color: #7b8998; font-size: 12px; line-height: 1.5; }
.data-source-groups { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.data-source-group { display: grid; gap: 6px; min-width: 0; }
.data-source-group > strong { color: #526276; font-size: 12px; font-weight: 650; }
.data-source-row { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; border: 0; border-bottom: 1px solid #e5e9ee; padding: 6px 0; background: transparent; color: #334457; font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.data-source-row.component-row { cursor: grab; }
.data-source-row:hover { border-bottom-color: #9fb2c5; color: #244c74; }
.data-source-row.component-row:active { cursor: grabbing; }
.data-source-row > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.data-source-row small { color: #8a96a3; font-size: 10px; }
.empty-copy { color: #8a96a3; font-size: 12px; }
.settings-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.settings-grid > div { display: grid; gap: 3px; border-bottom: 1px solid #e5e9ee; padding: 4px 0; }
.settings-grid span { color: #8290a0; font-size: 11px; }
.settings-grid strong { overflow: hidden; color: #334457; font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.canvas-stage { position: relative; flex: 1; min-height: 620px; overflow: hidden; background: #eef1f4; }
.designer-host { position: absolute; z-index: 1; inset: 0; overflow: auto; background: #fff; opacity: 1; }
.designer-host-preview { opacity: 0; pointer-events: none; }
.designer-host print-designer { display: block; min-height: 100%; }
.preview-surface { position: absolute; z-index: 2; inset: 0; overflow: auto; padding: 28px; background: #eef1f4; }
.preview-paper-wrap { display: flex; min-height: 100%; justify-content: center; align-items: flex-start; }
.preview-frame { width: min(794px, 100%); min-height: 1040px; border: 0; background: #fff; box-shadow: 0 3px 14px rgb(30 44 60 / 14%); }
.preview-empty { display: grid; place-items: center; min-height: 360px; gap: 7px; color: #788696; font-size: 13px; text-align: center; }
.preview-empty strong { color: #4a5b6d; font-size: 15px; font-weight: 600; }
.decision-overlay { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; padding: 20px; background: rgb(15 23 42 / 55%); }
.decision-card { width: min(420px, 100%); border: 1px solid #cbd3dc; border-radius: 8px; padding: 20px; background: #fff; box-shadow: 0 14px 36px rgb(30 44 60 / 20%); }
.decision-card h2 { margin: 0; color: #233345; font-size: 17px; font-weight: 650; }
.decision-card p { margin: 10px 0 20px; color: #647184; font-size: 13px; line-height: 1.6; }
.decision-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
@media (max-width: 640px) {
  .app-shell { padding: 12px; }
  .app-header { grid-template-columns: 1fr; gap: 10px; }
  .header-actions { width: 100%; }
  .header-actions .button { flex: 1; }
  .workspace { grid-template-columns: 1fr; }
  .sidebar { border-right: 0; border-bottom: 1px solid #dfe4ea; }
  .sidebar-footer { display: none; }
  .editor-nav { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; }
  .editor-nav .sidebar-title-row { grid-column: 1 / -1; }
  .editor-nav-item { justify-content: center; padding: 8px 4px; }
  .editor-nav-index { display: none; }
  .workspace-toolbar { align-items: flex-start; flex-direction: column; }
  .context-panel-compact { align-items: flex-start; flex-direction: column; gap: 8px; }
  .data-source-groups, .settings-grid { grid-template-columns: 1fr; }
  .canvas-stage { min-height: 560px; }
  .preview-surface { padding: 12px; }
  .preview-frame { min-height: 760px; }
}
</style>
