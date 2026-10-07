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
    (designerRef.value as DesignerElement & { setTheme?: (theme: string) => void })
      .setTheme?.("light");
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
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" role="presentation">
            <path d="M7 3.75h7.2L18 7.55v12.7H7z" />
            <path d="M14 3.75v4h4M9.5 12h6M9.5 15h4.5" />
          </svg>
        </span>
        <div class="brand-copy">
          <h1>多维打印</h1>
          <p class="eyebrow">多维表格打印工作台</p>
        </div>
      </div>
      <div class="header-context">
        <span class="context-label">数据表</span>
        <strong>{{ printJob?.table.name || "正在读取数据表" }}</strong>
        <span class="context-divider" aria-hidden="true"></span>
        <span>{{ currentRecordLabel }}</span>
      </div>
      <div class="header-actions">
        <div class="header-actions-secondary">
          <button v-if="!isBatchMode" class="button button-quiet" :disabled="busy" @click="requestLoadRecords(false)">
            {{ busy ? "读取中…" : "重新读取" }}
          </button>
          <button class="button button-quiet" :disabled="busy || !templateLoaded" @click="requestLoadRecords(true)">
            {{ batchWorkspaceActions.selectLabel }}
          </button>
          <button v-if="isBatchMode" class="button button-quiet" :disabled="busy" @click="requestExitBatch">退出批量</button>
        </div>
        <div class="header-actions-primary">
          <button class="button button-outline button-output" :disabled="batchWorkspaceActions.outputDisabled" @click="exportPdf">
            {{ batchWorkspaceActions.exportPdfLabel }}
          </button>
          <button class="button button-primary button-output" :disabled="batchWorkspaceActions.outputDisabled" @click="printOutput">
            {{ batchWorkspaceActions.printLabel }}
          </button>
        </div>
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
.app-shell {
  min-height: 100dvh;
  padding: clamp(12px, 1.5vw, 22px);
  color: var(--dw-color-text);
  background: var(--dw-color-surface-subtle);
}

.app-header {
  display: grid;
  grid-template-columns: minmax(178px, auto) minmax(160px, 1fr) auto;
  align-items: center;
  gap: clamp(18px, 2.4vw, 34px);
  min-height: 72px;
  margin-bottom: 10px;
  border: 1px solid var(--dw-color-border);
  border-radius: var(--dw-radius-panel);
  padding: 12px 14px;
  background: color-mix(in srgb, var(--dw-color-surface) 96%, transparent);
  box-shadow: var(--dw-shadow-panel);
}

.brand-block,
.header-context,
.header-actions,
.header-actions-secondary,
.header-actions-primary,
.workspace-actions {
  display: flex;
  align-items: center;
}

.brand-block { gap: 10px; min-width: 0; }
.brand-mark {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  place-items: center;
  border-radius: 10px;
  background: var(--dw-color-accent);
  color: #fff;
  box-shadow: 0 5px 14px rgb(51 112 255 / 22%);
}
.brand-mark svg { width: 22px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.65; }
.brand-copy { display: grid; min-width: 0; gap: 1px; }
.brand-block h1 { margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -.02em; line-height: 1.25; }
.eyebrow { margin: 0; color: var(--dw-color-text-tertiary); font-size: 11px; line-height: 1.4; }

.header-context { min-width: 0; gap: 8px; color: var(--dw-color-text-secondary); font-size: 12px; }
.header-context strong { overflow: hidden; color: var(--dw-color-text); font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.context-label { flex: 0 0 auto; border-radius: 5px; padding: 3px 6px; background: var(--dw-color-surface-subtle); color: var(--dw-color-text-tertiary); font-size: 10px; }
.context-divider { width: 1px; height: 14px; margin: 0 2px; background: var(--dw-color-border); }

.header-actions { justify-content: flex-end; gap: 10px; }
.header-actions-secondary,
.header-actions-primary,
.workspace-actions { flex-wrap: wrap; gap: 6px; }
.header-actions-primary { padding-left: 10px; border-left: 1px solid var(--dw-color-border); }

.button {
  min-height: 34px;
  border: 1px solid var(--dw-color-border-strong);
  border-radius: var(--dw-radius-control);
  padding: 7px 12px;
  background: var(--dw-color-surface);
  color: var(--dw-color-text);
  font: inherit;
  font-size: 12px;
  font-weight: 520;
  line-height: 1;
  transition: border-color .18s ease, background-color .18s ease, color .18s ease, box-shadow .18s ease, transform .18s ease;
}
.button:hover:not(:disabled) { border-color: #aeb4bd; background: #f5f6f7; }
.button:active:not(:disabled) { transform: translateY(1px) scale(.985); }
.button:disabled { cursor: not-allowed; opacity: .42; }
.button-primary { border-color: var(--dw-color-accent); background: var(--dw-color-accent); color: #fff; box-shadow: 0 4px 12px rgb(51 112 255 / 18%); }
.button-primary:hover:not(:disabled) { border-color: var(--dw-color-accent-hover); background: var(--dw-color-accent-hover); box-shadow: 0 6px 16px rgb(51 112 255 / 23%); }
.button-primary:active:not(:disabled) { border-color: var(--dw-color-accent-pressed); background: var(--dw-color-accent-pressed); }
.button-outline { border-color: var(--dw-color-accent-border); color: var(--dw-color-accent-hover); }
.button-outline:hover:not(:disabled) { border-color: var(--dw-color-accent); background: var(--dw-color-accent-soft); color: var(--dw-color-accent-hover); }
.button-quiet { border-color: transparent; background: transparent; color: var(--dw-color-text-secondary); }
.button-quiet:hover:not(:disabled) { border-color: transparent; background: #f1f2f4; color: var(--dw-color-text); }
.button-output { min-width: 68px; }
.button-new-template { width: 100%; margin-top: 8px; border-style: dashed; border-color: var(--dw-color-accent-border); color: var(--dw-color-accent-hover); }
.button-new-template:hover:not(:disabled) { border-style: solid; border-color: var(--dw-color-accent); background: var(--dw-color-accent-soft); }
.button-link { min-height: 28px; border-color: transparent; padding: 4px 0; background: transparent; color: var(--dw-color-accent-hover); }

.button:focus-visible,
.template-item:focus-visible,
.template-item-actions button:focus-visible,
.editor-nav-item:focus-visible,
.data-source-row:focus-visible,
.status-retry-button:focus-visible {
  outline: 2px solid var(--dw-color-accent);
  outline-offset: 2px;
}

.status-line {
  display: flex;
  min-height: 34px;
  align-items: center;
  gap: 8px;
  margin: 0 4px 10px;
  color: var(--dw-color-text-secondary);
  font-size: 12px;
}
.status-dot { width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; background: var(--dw-color-success); box-shadow: 0 0 0 3px rgb(47 143 91 / 10%); }
.status-line-error { color: var(--dw-color-danger); }
.status-line-error .status-dot { background: var(--dw-color-danger); box-shadow: 0 0 0 3px rgb(200 75 69 / 10%); }
.status-retry-button { border: 0; border-radius: 5px; padding: 3px 6px; background: var(--dw-color-accent-soft); color: var(--dw-color-accent-hover); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.status-retry-button:hover { color: var(--dw-color-accent-pressed); }

:deep(.batch-bar) {
  display: flex;
  min-height: 38px;
  align-items: center;
  gap: 10px;
  margin: 0 4px 8px;
  border: 1px solid var(--dw-color-accent-border);
  border-radius: 10px;
  padding: 7px 10px;
  background: var(--dw-color-accent-soft);
  color: var(--dw-color-text-secondary);
  font-size: 12px;
}
:deep(.batch-bar strong) { flex: 0 0 auto; color: var(--dw-color-accent-hover); font-size: 12px; font-weight: 650; }
:deep(.batch-bar > span:nth-child(2)) { flex: 0 0 auto; border-radius: 5px; padding: 3px 6px; background: rgb(255 255 255 / 70%); color: var(--dw-color-text-secondary); }
:deep(.batch-summaries) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.workspace {
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr);
  min-height: calc(100dvh - 146px);
  overflow: hidden;
  border: 1px solid var(--dw-color-border);
  border-radius: var(--dw-radius-panel);
  background: var(--dw-color-surface);
  box-shadow: var(--dw-shadow-panel);
}
.sidebar { display: flex; min-width: 0; flex-direction: column; border-right: 1px solid var(--dw-color-border); background: var(--dw-color-surface-subtle); }
.sidebar-section { padding: 18px 14px; }
.batch-preview-sidebar { display: grid; gap: 10px; }
.batch-preview-sidebar > strong { overflow: hidden; color: var(--dw-color-text); font-size: 13px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.batch-preview-sidebar-note { color: var(--dw-color-text-tertiary); font-size: 11px; line-height: 1.55; }
.sidebar-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.sidebar-title { color: var(--dw-color-text); font-size: 12px; font-weight: 650; }
.sidebar-count { color: var(--dw-color-text-tertiary); font-size: 11px; font-variant-numeric: tabular-nums; }

.template-directory-row { position: relative; margin-bottom: 5px; border-radius: 10px; }
.template-item {
  display: flex;
  width: 100%;
  min-height: 52px;
  align-items: flex-start;
  gap: 9px;
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 10px 10px 9px;
  background: transparent;
  color: inherit;
  text-align: left;
  font: inherit;
  transition: border-color .18s ease, background-color .18s ease, box-shadow .18s ease, transform .18s ease;
}
.template-item:hover:not(:disabled) { background: #f0f2f5; }
.template-item-active { border-color: var(--dw-color-accent-border); background: var(--dw-color-accent-soft); box-shadow: inset 3px 0 0 var(--dw-color-accent); }
.template-item-active:hover:not(:disabled) { background: var(--dw-color-accent-soft); }
.template-item:active:not(:disabled) { transform: scale(.992); }
.template-item:disabled { cursor: default; opacity: .55; }
.template-item-mark { width: 8px; height: 8px; flex: 0 0 8px; margin-top: 4px; border: 2px solid var(--dw-color-surface-subtle); border-radius: 50%; background: var(--dw-color-text-tertiary); box-shadow: 0 0 0 1px var(--dw-color-border-strong); }
.template-item-active .template-item-mark { border-color: var(--dw-color-surface); background: var(--dw-color-accent); box-shadow: 0 0 0 1px var(--dw-color-accent); }
.template-item-copy { display: grid; min-width: 0; gap: 4px; }
.template-item-copy strong { overflow: hidden; color: var(--dw-color-text); font-size: 12px; font-weight: 620; text-overflow: ellipsis; white-space: nowrap; }
.template-item-copy small { color: var(--dw-color-text-tertiary); font-size: 10px; line-height: 1.35; }
.template-item-actions { display: flex; gap: 4px; margin: -3px 6px 5px 26px; opacity: 0; pointer-events: none; transform: translateY(-2px); transition: opacity .16s ease, transform .16s ease; }
.template-directory-row:hover .template-item-actions,
.template-directory-row:focus-within .template-item-actions { opacity: 1; pointer-events: auto; transform: translateY(0); }
.template-item-actions button { border: 0; border-radius: 5px; padding: 4px 6px; background: transparent; color: var(--dw-color-text-tertiary); font: inherit; font-size: 10px; }
.template-item-actions button:hover:not(:disabled) { background: #e8eaed; color: var(--dw-color-text); }
.template-item-actions button:last-child:hover:not(:disabled) { background: #fff0ef; color: var(--dw-color-danger); }
.template-item-actions button:disabled { opacity: .35; cursor: not-allowed; }

.editor-nav { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; border-bottom: 1px solid var(--dw-color-border); padding-bottom: 14px; }
.editor-nav .sidebar-title-row { grid-column: 1 / -1; margin-bottom: 5px; }
.editor-nav-item { display: flex; min-height: 34px; align-items: center; justify-content: center; gap: 6px; border: 1px solid transparent; border-radius: 8px; padding: 7px; background: transparent; color: var(--dw-color-text-secondary); text-align: center; font: inherit; font-size: 12px; transition: background-color .18s ease, color .18s ease, border-color .18s ease; }
.editor-nav-item:hover { background: #eceef1; color: var(--dw-color-text); }
.editor-nav-item-active { border-color: var(--dw-color-accent-border); background: var(--dw-color-surface); color: var(--dw-color-accent-hover); font-weight: 620; box-shadow: 0 2px 8px rgb(31 35 41 / 6%); }
.editor-nav-index { display: none; }
.editor-content { display: grid; align-content: start; gap: 3px; overflow: auto; }
.editor-content > strong { margin: 10px 0 3px; color: var(--dw-color-text-tertiary); font-size: 10px; font-weight: 650; letter-spacing: .06em; }
.data-source-row { display: flex; width: 100%; min-height: 36px; align-items: center; justify-content: space-between; gap: 10px; border: 0; border-radius: 7px; padding: 7px 8px; background: transparent; color: var(--dw-color-text-secondary); font: inherit; font-size: 12px; text-align: left; cursor: pointer; transition: background-color .16s ease, color .16s ease, transform .16s ease; }
.data-source-row:hover { background: var(--dw-color-surface); color: var(--dw-color-text); box-shadow: 0 2px 8px rgb(31 35 41 / 6%); }
.data-source-row:active { transform: scale(.99); }
.data-source-row.component-row { cursor: grab; }
.data-source-row.component-row:active { cursor: grabbing; }
.data-source-row > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.data-source-row small { flex: 0 0 auto; color: var(--dw-color-accent-hover); font-size: 10px; opacity: 0; transition: opacity .16s ease; }
.data-source-row:hover small,
.data-source-row:focus-visible small { opacity: 1; }
.component-row small { opacity: 1; color: var(--dw-color-text-tertiary); }
.empty-copy { padding: 8px; color: var(--dw-color-text-tertiary); font-size: 11px; }

.sidebar-footer { display: flex; min-height: 58px; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; border-top: 1px solid var(--dw-color-border); padding: 12px 14px; background: rgb(255 255 255 / 52%); }
.status-chip { display: inline-flex; width: fit-content; align-items: center; border-radius: 5px; padding: 4px 7px; background: #eceef1; color: var(--dw-color-text-secondary); font-size: 10px; font-weight: 600; }
.status-saved { background: #edf8f1; color: var(--dw-color-success); }
.status-unsaved { background: #fff6e8; color: var(--dw-color-warning); }
.status-fallback { background: #fff0ef; color: var(--dw-color-danger); }

.workspace-main { display: flex; min-width: 0; flex-direction: column; background: var(--dw-color-surface); }
.workspace-toolbar { display: flex; min-height: 66px; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--dw-color-border); padding: 12px 16px 12px 18px; background: rgb(255 255 255 / 95%); }
.workspace-kicker { margin: 0 0 4px; color: var(--dw-color-text-tertiary); font-size: 10px; letter-spacing: .04em; }
.workspace-toolbar h2 { max-width: min(46vw, 620px); margin: 0; overflow: hidden; color: var(--dw-color-text); font-size: 16px; font-weight: 680; letter-spacing: -.01em; text-overflow: ellipsis; white-space: nowrap; }
.save-state { color: var(--dw-color-text-tertiary); font-size: 11px; }

.canvas-stage { position: relative; flex: 1; min-height: 620px; overflow: hidden; background: var(--dw-color-canvas); }
.canvas-stage::before { position: absolute; z-index: 0; inset: 0; background-image: radial-gradient(circle at 1px 1px, rgb(100 106 115 / 9%) 1px, transparent 0); background-size: 20px 20px; content: ""; opacity: .28; pointer-events: none; }
.designer-host { position: absolute; z-index: 1; inset: 0; overflow: auto; background: var(--dw-color-surface); opacity: 1; transition: opacity .18s ease; }
.designer-host-preview { opacity: 0; pointer-events: none; }
.designer-host print-designer { display: block; min-height: 100%; }
.preview-surface { position: absolute; z-index: 2; inset: 0; overflow: auto; padding: clamp(22px, 3vw, 46px); background: transparent; scrollbar-color: #aeb4bd transparent; }
.preview-paper-wrap { display: flex; min-height: 100%; justify-content: center; align-items: flex-start; }
.preview-frame { width: min(794px, 100%); min-height: 1040px; border: 1px solid rgb(31 35 41 / 8%); border-radius: 2px; background: var(--dw-color-surface); box-shadow: var(--dw-shadow-paper); }
.preview-empty { display: grid; min-height: 420px; place-content: center; justify-items: center; gap: 8px; color: var(--dw-color-text-tertiary); font-size: 12px; text-align: center; }
.preview-empty::before { width: 92px; height: 122px; margin-bottom: 8px; border: 1px solid var(--dw-color-border-strong); border-radius: 3px; background: linear-gradient(110deg, #fff 32%, #f4f5f6 45%, #fff 58%); background-size: 240% 100%; box-shadow: 0 10px 28px rgb(31 35 41 / 10%); content: ""; animation: paper-loading 1.8s ease-in-out infinite; }
.preview-empty strong { color: var(--dw-color-text); font-size: 14px; font-weight: 630; }

.decision-overlay { position: fixed; z-index: 30; inset: 0; display: grid; place-items: center; padding: 20px; background: rgb(31 35 41 / 38%); backdrop-filter: blur(5px); }
.decision-card { width: min(420px, 100%); border: 1px solid rgb(255 255 255 / 80%); border-radius: 16px; padding: 22px; background: var(--dw-color-surface); box-shadow: 0 24px 70px rgb(31 35 41 / 24%); }
.decision-card h2 { margin: 0; color: var(--dw-color-text); font-size: 17px; font-weight: 680; letter-spacing: -.01em; }
.decision-card p { margin: 10px 0 22px; color: var(--dw-color-text-secondary); font-size: 13px; line-height: 1.65; }
.decision-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }

@keyframes paper-loading {
  0%, 100% { background-position: 100% 0; transform: translateY(0); }
  50% { background-position: 0 0; transform: translateY(-2px); }
}

@media (max-width: 1120px) {
  .app-header { grid-template-columns: minmax(178px, auto) 1fr; }
  .header-actions { grid-column: 1 / -1; justify-content: space-between; border-top: 1px solid var(--dw-color-border); padding-top: 10px; }
  .workspace { grid-template-columns: 228px minmax(0, 1fr); }
}

@media (max-width: 720px) {
  .app-shell { padding: 10px; }
  .app-header { grid-template-columns: 1fr; gap: 10px; border-radius: 12px; }
  .header-context { overflow: hidden; }
  .header-actions { grid-column: auto; align-items: stretch; flex-direction: column; }
  .header-actions-secondary,
  .header-actions-primary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 100%; padding: 0; border: 0; }
  .header-actions-secondary .button,
  .header-actions-primary .button { width: 100%; }
  .workspace { grid-template-columns: 1fr; min-height: auto; }
  .sidebar { max-height: 360px; border-right: 0; border-bottom: 1px solid var(--dw-color-border); }
  .sidebar-footer { display: none; }
  .template-item-actions { opacity: 1; pointer-events: auto; transform: none; }
  .workspace-toolbar { align-items: flex-start; flex-direction: column; }
  .workspace-toolbar h2 { max-width: 88vw; }
  .workspace-actions { width: 100%; }
  .workspace-actions .button { flex: 1; }
  .canvas-stage { min-height: 560px; }
  .preview-surface { padding: 16px 10px 26px; }
  .preview-frame { min-height: 760px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}
</style>
