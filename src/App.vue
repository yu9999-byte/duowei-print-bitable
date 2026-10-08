<script setup lang="ts">
import { bitable } from "@lark-base-open/js-sdk";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
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
import { commitBatchTemplateEdit } from "./core/batch-template-edit.ts";
import type { RenderedPrintJob } from "./engine/designer-adapter.ts";
import {
  buildDataSourceClipboardPayload,
  fieldDataSourceId,
  SYSTEM_PRINT_DATE_ID,
} from "./core/data-sources.ts";
import type { StoredTemplate, TemplateCollection } from "./core/template-repository.ts";
import {
  getBatchReadFailureFeedback,
} from "./components/batch-read-feedback.ts";
import { getBatchWorkspaceActionState } from "./components/batch-workspace-action-state.ts";
import { normalizeTemplateName } from "./components/template-management.ts";
import { getWorkspacePresentation } from "./components/workspace-presentation.ts";
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
const templateManagementDialog = ref<{ action: "rename" | "remove"; item: StoredTemplate } | null>(null);
const templateRenameInput = ref("");
const templateRenameInputRef = ref<HTMLInputElement | null>(null);
const templateManagementCardRef = ref<HTMLElement | null>(null);
const templateManagementCancelRef = ref<HTMLButtonElement | null>(null);
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
const batchPreviewStale = ref(false);
const status = ref("正在读取当前记录…");
const error = ref("");
const busy = ref(false);
const activeTemplateMenuId = ref<string | null>(null);
const newTemplateMenuOpen = ref(false);
const editMoreMenuOpen = ref(false);
const statusToastVisible = ref(false);
let contextRevision = 0;
let candidateRender: Promise<RenderedPrintJob> | null = null;
let statusToastTimer: ReturnType<typeof setTimeout> | undefined;
let stopSelectionWatch: (() => void) | undefined;
let stopDataSourceTerminology: (() => void) | undefined;
let stopDataSourceEditingLifecycle: (() => void) | undefined;
let stopDesignerPrintInterception: (() => void) | undefined;
let stopDesignerSaveInterception: (() => void) | undefined;
let stopDesignerWorkspaceChrome: (() => void) | undefined;
let stopDesignerTemplatePanelSuppression: (() => void) | undefined;
let stopDesignerDirtyTracking: (() => void) | undefined;
let resolveDesignerReady: (() => void) | undefined;
let templateManagementReturnFocus: HTMLElement | null = null;
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
const visibleTemplateCount = computed(() => templateCollection.value.templates.length
  + ((!templateCollection.value.templates.length || selectedTemplateId.value === "automatic") ? 1 : 0));
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
const presentation = computed(() => getWorkspacePresentation(workspaceSurface.value));
const showBatchRetry = computed(() => batchWorkspaceActions.value.retryVisible);
const previewFrameHeight = computed(() => `${renderedPages.value ? renderedPreviewHeight(renderedPages.value) : 1040}px`);
const hasFeedbackError = computed(() => Boolean(error.value || templateWarning.value || previewError.value));
const showStatusFeedback = computed(() => busy.value
  || hasFeedbackError.value
  || showBatchRetry.value
  || statusToastVisible.value);
const normalizedTemplateRename = computed(() => normalizeTemplateName(templateRenameInput.value));
const templateManagementConfirmDisabled = computed(() => {
  if (busy.value || !templateManagementDialog.value) return true;
  if (templateManagementDialog.value.action === "remove") return false;
  return !normalizedTemplateRename.value
    || normalizedTemplateRename.value === templateManagementDialog.value.item.name;
});

watch(status, () => {
  statusToastVisible.value = true;
  if (statusToastTimer) clearTimeout(statusToastTimer);
  statusToastTimer = setTimeout(() => {
    statusToastVisible.value = false;
  }, 2600);
});

function closeTransientMenus() {
  activeTemplateMenuId.value = null;
  newTemplateMenuOpen.value = false;
  editMoreMenuOpen.value = false;
}

function toggleTemplateMenu(id: string) {
  newTemplateMenuOpen.value = false;
  editMoreMenuOpen.value = false;
  activeTemplateMenuId.value = activeTemplateMenuId.value === id ? null : id;
}

function toggleNewTemplateMenu() {
  activeTemplateMenuId.value = null;
  editMoreMenuOpen.value = false;
  newTemplateMenuOpen.value = !newTemplateMenuOpen.value;
}

function toggleEditMoreMenu() {
  activeTemplateMenuId.value = null;
  newTemplateMenuOpen.value = false;
  editMoreMenuOpen.value = !editMoreMenuOpen.value;
}

function handleGlobalPointerDown(event: PointerEvent) {
  const target = event.target;
  if (target instanceof Element && target.closest(".menu-anchor")) return;
  closeTransientMenus();
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  if (templateManagementDialog.value && !busy.value) closeTemplateManagementDialog();
  else closeTransientMenus();
}

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
  templateManagementDialog.value = null;
  templateRenameInput.value = "";
  templateManagementReturnFocus = null;
  pendingContext.value = null;
  pendingLoadRequest.value = null;
  previewHtml.value = "";
  previewError.value = "";
  templateWarning.value = "";
  batchRetryAvailable.value = false;
  workspaceMode.value = initialWorkspaceMode();
  batchSession.value = createSinglePrintSession(null);
  renderedPages.value = null;
  batchPreviewStale.value = false;
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
    templateManagementDialog.value = null;
    templateRenameInput.value = "";
    templateManagementReturnFocus = null;
    pendingContext.value = null;
    pendingLoadRequest.value = null;
    previewHtml.value = "";
    previewError.value = "";
    templateWarning.value = "";
    workspaceMode.value = initialWorkspaceMode();
    renderedPages.value = null;
    batchPreviewStale.value = false;
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
    batchPreviewStale.value = false;
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
    batchPreviewStale.value = false;
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
      batchPreviewStale.value = false;
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
    batchPreviewStale.value = false;
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
    designerRef.value.setTheme?.("light");
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
  if (!designerRef.value || !selection.value || !templateSaveAllowed.value
    || (workspaceMode.value !== "edit" && !options.returnToPreview)) return false;
  closeTransientMenus();
  const active = selection.value;
  const revision = contextRevision;
  const batchEditing = isBatchMode.value;
  busy.value = true;
  error.value = "";
  try {
    if (!options.allowContextChange) await assertCurrentContext(active, revision);
    const id = draftTemplateId.value ?? (selectedTemplateId.value === "automatic"
      ? crypto.randomUUID() : selectedTemplateId.value);
    if (!id) throw new Error("请先选择模板");
    const persistentTemplate = getPersistentTemplateData(designerRef.value);
    const persist = async () => {
      const updated = await templateRepository.upsert(
        { baseId: active.baseId, tableId: active.tableId },
        persistentTemplate,
        { id, name: currentTemplateName.value, expectedRevision: templateCollection.value.revision },
      );
      if (!options.allowContextChange) await assertCurrentContext(active, revision);
      return updated;
    };
    let renderedBatch: RenderedPrintJob | null = null;
    let renderFailure: Error | null = null;
    let updated: TemplateCollection;
    if (batchEditing) {
      if (!printJob.value || !renderedPages.value) throw new Error("当前批量预览尚未准备好，不能保存模板");
      const result = await commitBatchTemplateEdit({
        previousRendered: renderedPages.value,
        persist,
        render: () => renderPrintJobPages(designerRef.value!, printJob.value!, undefined,
          () => revision === contextRevision),
      });
      updated = result.saved;
      renderedBatch = result.rendered;
      if (!result.ok) renderFailure = result.error;
    } else {
      updated = await persist();
    }
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
    if (batchEditing && renderFailure) {
      batchPreviewStale.value = true;
      error.value = `模板已保存，但批量预览刷新失败：${renderFailure.message}`;
      status.value = "模板已保存，原批量预览仍保留；请重试刷新";
      return false;
    }
    if (renderedBatch) {
      renderedPages.value = renderedBatch;
      previewHtml.value = composeRenderedPrintPages(renderedBatch);
      previewError.value = "";
      batchPreviewStale.value = false;
      workspaceMode.value = "preview";
      status.value = `模板已保存，已按 ${batchSession.value.committedRecordIds.length} 条记录刷新批量预览`;
    } else if (options.returnToPreview) {
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
  closeTransientMenus();
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
  closeTransientMenus();
  await loadTemplateAndPreview(printJob.value, selection.value, contextRevision, id);
}

async function updateDirectory(
  action: "rename" | "remove" | "default",
  item: StoredTemplate,
  renameTo?: string,
): Promise<boolean> {
  if (isBatchMode.value || !selection.value || busy.value) return false;
  closeTransientMenus();
  const active = selection.value;
  const revision = contextRevision;
  busy.value = true;
  error.value = "";
  try {
    await assertCurrentContext(active, revision);
    const context = { baseId: active.baseId, tableId: active.tableId };
    const expected = templateCollection.value.revision;
    const updated = action === "rename"
      ? await templateRepository.rename(context, item.id, renameTo!, expected)
      : action === "remove"
        ? await templateRepository.remove(context, item.id, expected)
        : await templateRepository.setDefault(context, item.id, expected);
    await assertCurrentContext(active, revision);
    templateCollection.value = updated;
    status.value = action === "rename" ? "模板已重命名" : action === "remove" ? "模板已删除" : "默认模板已更新";
    if (action === "remove" && selectedTemplateId.value === item.id) {
      await loadTemplateAndPreview(printJob.value, active, revision, updated.defaultId);
    }
    return true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "模板目录操作失败";
    status.value = "模板目录未更新";
    return false;
  } finally {
    busy.value = false;
  }
}

async function requestDirectoryAction(action: "rename" | "remove" | "default", item: StoredTemplate) {
  const activeElement = document.activeElement;
  templateManagementReturnFocus = activeElement instanceof HTMLElement
    ? activeElement.closest(".template-directory-row")?.querySelector<HTMLElement>(".template-more-button") ?? null
    : null;
  closeTransientMenus();
  if (action === "default") {
    templateManagementReturnFocus = null;
    await updateDirectory(action, item);
    return;
  }
  templateManagementDialog.value = { action, item };
  templateRenameInput.value = action === "rename" ? item.name : "";
  if (action === "rename") {
    await nextTick();
    templateRenameInputRef.value?.focus();
    templateRenameInputRef.value?.select();
  } else {
    await nextTick();
    templateManagementCancelRef.value?.focus();
  }
}

function closeTemplateManagementDialog() {
  if (busy.value) return;
  const returnFocus = templateManagementReturnFocus;
  templateManagementDialog.value = null;
  templateRenameInput.value = "";
  templateManagementReturnFocus = null;
  void nextTick(() => {
    if (returnFocus?.isConnected) returnFocus.focus();
  });
}

function trapTemplateManagementFocus(event: KeyboardEvent) {
  const dialog = templateManagementCardRef.value;
  if (!dialog) return;
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
  ));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function confirmTemplateManagement() {
  const dialog = templateManagementDialog.value;
  if (!dialog || templateManagementConfirmDisabled.value) return;
  const completed = await updateDirectory(
    dialog.action,
    dialog.item,
    dialog.action === "rename" ? normalizedTemplateRename.value! : undefined,
  );
  if (completed) closeTemplateManagementDialog();
}

function enterEditMode() {
  if (isBatchMode.value && !renderedPages.value) {
    status.value = "请先等待批量预览生成完成";
    return;
  }
  if (!canEnterTemplateEdit({
    templateLoaded: templateLoaded.value,
    templateSelected: templateSelected.value,
  })) {
    status.value = "请先在模板目录中选择模板";
    return;
  }
  closeTransientMenus();
  workspaceMode.value = "edit";
  if (!isBatchMode.value) {
    renderedPages.value = null;
    previewHtml.value = "";
  }
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

async function restoreBatchEditBaseline(): Promise<boolean> {
  if (!isBatchMode.value || !designerRef.value || !printJob.value) return false;
  const active = selection.value;
  const revision = contextRevision;
  busy.value = true;
  error.value = "";
  let baselineRestored = false;
  try {
    const warning = await bindStoredTemplateOrFallback(
      designerRef.value,
      storedTemplate.value?.template,
      printJob.value,
    );
    if (warning) throw new Error(warning);
    templateDirty.value = false;
    captureTemplateBaseline();
    baselineRestored = true;
    if (batchPreviewStale.value) {
      const rendered = await renderPrintJobPages(
        designerRef.value,
        printJob.value,
        undefined,
        () => revision === contextRevision,
      );
      if (active) await assertCurrentContext(active, revision);
      renderedPages.value = rendered;
      previewHtml.value = composeRenderedPrintPages(rendered);
      previewError.value = "";
      batchPreviewStale.value = false;
    }
    workspaceMode.value = "preview";
    status.value = "已放弃修改并返回原批量预览";
    return true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "无法恢复保存前的批量模板";
    status.value = baselineRestored
      ? "修改已放弃，原批量预览仍保留；请重试刷新"
      : "模板草稿仍保留";
    return false;
  } finally {
    busy.value = false;
  }
}

async function refreshStaleBatchPreview(): Promise<boolean> {
  if (!isBatchMode.value || !designerRef.value || !printJob.value || !renderedPages.value) return false;
  const active = selection.value;
  const revision = contextRevision;
  busy.value = true;
  error.value = "";
  try {
    const rendered = await renderPrintJobPages(
      designerRef.value,
      printJob.value,
      undefined,
      () => revision === contextRevision,
    );
    if (active) await assertCurrentContext(active, revision);
    renderedPages.value = rendered;
    previewHtml.value = composeRenderedPrintPages(rendered);
    previewError.value = "";
    batchPreviewStale.value = false;
    workspaceMode.value = "preview";
    status.value = `已按 ${batchSession.value.committedRecordIds.length} 条记录刷新批量预览`;
    return true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "批量预览刷新失败";
    status.value = "原批量预览仍保留；请继续编辑或重试";
    return false;
  } finally {
    busy.value = false;
  }
}

function requestPreviewMode() {
  closeTransientMenus();
  if (workspaceMode.value !== "edit") {
    void refreshPreview();
    return;
  }
  if (shouldGuardUnsavedNavigation(refreshTemplateDirtyState())) {
    decisionDialog.value = "leave";
    return;
  }
  if (isBatchMode.value) {
    if (batchPreviewStale.value) {
      void refreshStaleBatchPreview();
      return;
    }
    workspaceMode.value = "preview";
    status.value = "已返回批量预览";
    return;
  }
  void applyPreviewMode();
}

function requestTemplateReload() {
  closeTransientMenus();
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
      if (request === "batch" && workspaceMode.value === "edit" && !await applyPreviewMode()) return;
    } else if (request === "batch" || request === "exit") {
      const loaded = isBatchMode.value && workspaceMode.value === "edit"
        ? await restoreBatchEditBaseline()
        : await loadTemplateAndPreview(printJob.value, selection.value, contextRevision,
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
    const loaded = isBatchMode.value && workspaceMode.value === "edit"
      ? await restoreBatchEditBaseline()
      : await loadTemplateAndPreview(printJob.value, selection.value, contextRevision,
        draftOriginId.value ?? (selectedTemplateId.value === "automatic" ? null : selectedTemplateId.value));
    if (!loaded) return;
  }
  if (action === "leave" && workspaceMode.value === "edit") await applyPreviewMode();
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
  document.addEventListener("pointerdown", handleGlobalPointerDown);
  document.addEventListener("keydown", handleGlobalKeydown);
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
  document.removeEventListener("pointerdown", handleGlobalPointerDown);
  document.removeEventListener("keydown", handleGlobalKeydown);
  if (statusToastTimer) clearTimeout(statusToastTimer);
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
  <main class="app-shell" :class="`surface-${workspaceSurface}`">
    <header v-if="presentation.showBrand" class="app-header">
      <div class="brand-block" aria-label="多维打印">
        <span class="brand-mark" aria-hidden="true">印</span>
        <h1>多维打印</h1>
      </div>
      <div class="header-context">
        <span>{{ printJob?.table.name || "正在读取数据表" }}</span>
        <span class="context-divider" aria-hidden="true">/</span>
        <span>{{ currentRecordLabel }}</span>
      </div>
      <div class="header-actions">
        <template v-if="workspaceSurface === 'batch-edit'">
          <button class="button button-tertiary" :disabled="busy" @click="requestPreviewMode">
            <span aria-hidden="true">←</span> 返回批量预览
          </button>
          <button v-if="presentation.showSave" class="button button-primary"
            :disabled="busy || !templateSaveAllowed" @click="saveTemplate()">保存模板</button>
        </template>
        <template v-else>
        <button v-if="presentation.showRecordPicker" class="button button-secondary button-record-picker"
          :disabled="busy || !templateLoaded" @click="requestLoadRecords(true)">
          {{ batchWorkspaceActions.selectLabel }}
        </button>
        <button v-if="presentation.showExitBatch" class="button button-tertiary" :disabled="busy"
          @click="requestExitBatch">退出批量</button>
        <button v-if="presentation.showOutputs" :disabled="batchWorkspaceActions.outputDisabled"
          class="button button-secondary" @click="exportPdf">
          {{ batchWorkspaceActions.exportPdfLabel }}
        </button>
        <button v-if="presentation.showOutputs" class="button button-primary" :disabled="batchWorkspaceActions.outputDisabled" @click="printOutput">
          {{ batchWorkspaceActions.printLabel }}
        </button>
        </template>
      </div>
    </header>

    <header v-else class="app-header app-header-edit">
      <button class="button button-tertiary back-button" :disabled="busy" @click="requestPreviewMode">
        <span aria-hidden="true">←</span> 返回预览
      </button>
      <div class="edit-header-context">
        <strong>{{ currentTemplateName }}</strong>
        <span class="status-chip" :class="`status-${templateStatus}`">{{ templateStatusLabel }}</span>
      </div>
      <div class="header-actions">
        <div class="menu-anchor edit-more-anchor">
          <button class="button button-tertiary" type="button" aria-haspopup="menu"
            :aria-expanded="editMoreMenuOpen" @click="toggleEditMoreMenu">更多</button>
          <div v-if="editMoreMenuOpen" class="action-menu action-menu-right" role="menu">
            <button class="action-menu-item" role="menuitem" :disabled="busy || !designerReady || !printJob"
              @click="requestTemplateReload">重新加载模板</button>
          </div>
        </div>
        <button v-if="presentation.showSave" class="button button-primary"
          :disabled="busy || !templateSaveAllowed" @click="saveTemplate()">保存模板</button>
      </div>
    </header>

    <div v-if="showStatusFeedback" class="status-line" :class="{ 'status-line-error': hasFeedbackError }"
      :role="hasFeedbackError ? 'alert' : 'status'" aria-live="polite">
      <span class="status-indicator" aria-hidden="true"></span>
      <span>{{ status }}</span>
      <span v-if="templateWarning">模板：{{ templateWarning }}</span>
      <span v-if="previewError">预览：{{ previewError }}</span>
      <span v-if="error">{{ error }}</span>
      <button v-if="showBatchRetry" class="status-retry-button" type="button"
        @click="requestLoadRecords(true)">重试批量读取</button>
    </div>

    <section class="workspace" :class="`workspace-${workspaceMode}`">
      <aside class="sidebar" :aria-label="presentation.showBatchSummary ? '批量打印目录' : presentation.showTemplateDirectory ? '模板目录' : '编辑操作区'">
        <section v-if="presentation.showBatchSummary" class="sidebar-section batch-preview-sidebar">
          <div class="sidebar-title-row">
            <span class="sidebar-title">本次打印</span>
            <span v-if="workspaceSurface === 'batch-preview'" class="readonly-tag">预览</span>
            <span v-else class="readonly-tag readonly-tag-editing">编辑中</span>
          </div>
          <div class="batch-count"><strong>{{ batchSession.committedRecordIds.length }}</strong><span>条记录</span></div>
          <dl class="batch-metadata">
            <div><dt>模板</dt><dd>{{ currentTemplateName }}</dd></div>
            <div><dt>排版</dt><dd>{{ renderedLayoutLabel }}</dd></div>
          </dl>
          <ul class="batch-record-list" aria-label="已选择记录">
            <li v-for="summary in batchWorkspaceActions.summaries.slice(0, 5)" :key="summary.recordId">
              <span>{{ summary.label }}</span>
            </li>
          </ul>
          <span v-if="batchWorkspaceActions.summaries.length > 5" class="batch-remainder">
            另有 {{ batchWorkspaceActions.summaries.length - 5 }} 条记录
          </span>
        </section>

        <section v-if="presentation.showTemplateDirectory" class="sidebar-section template-section">
          <div class="sidebar-title-row">
            <span class="sidebar-title">模板</span>
            <span class="sidebar-count">{{ visibleTemplateCount }} 个</span>
          </div>
          <div class="template-list">
            <button
              v-if="!templateCollection.templates.length || selectedTemplateId === 'automatic'"
              class="template-item"
              :class="{ 'template-item-active': selectedTemplateId === 'automatic' }"
              :disabled="!templateLoaded"
              @click="selectTemplate('automatic')"
            >
              <span class="template-item-copy">
                <strong>自动模板</strong>
                <small>{{ templateFallback ? '只读回退' : '未保存' }}</small>
              </span>
            </button>
            <div v-for="item in templateCollection.templates" :key="item.id" class="template-directory-row"
              :class="{ 'template-directory-row-active': selectedTemplateId === item.id }">
              <button class="template-item" :class="{ 'template-item-active': selectedTemplateId === item.id }"
                :disabled="busy" @click="selectTemplate(item.id)">
                <span class="template-item-copy">
                  <strong>{{ item.name }}</strong>
                  <small>
                    <span class="template-layout-label">{{ templateLayoutLabel(item.template) }}</span>
                    <span v-if="item.id === templateCollection.defaultId" class="default-tag">默认</span>
                  </small>
                </span>
              </button>
              <div class="menu-anchor template-more-anchor">
                <button class="template-more-button" type="button" aria-haspopup="menu"
                  :aria-expanded="activeTemplateMenuId === item.id" :aria-label="`${item.name}的更多操作`"
                  :disabled="busy" @click.stop="toggleTemplateMenu(item.id)">···</button>
                <div v-if="activeTemplateMenuId === item.id" class="action-menu template-action-menu" role="menu">
                  <button class="action-menu-item" role="menuitem" :disabled="busy"
                    @click="requestDirectoryAction('rename', item)">重命名</button>
                  <button v-if="item.id !== templateCollection.defaultId" class="action-menu-item" role="menuitem"
                    :disabled="busy" @click="requestDirectoryAction('default', item)">设为默认模板</button>
                  <button class="action-menu-item action-menu-danger" role="menuitem"
                    :disabled="busy || (item.id === templateCollection.defaultId && templateCollection.templates.length > 1)"
                    @click="requestDirectoryAction('remove', item)">删除模板</button>
                </div>
              </div>
            </div>
          </div>
          <div class="template-create menu-anchor">
            <button class="button button-secondary button-new-template" type="button" aria-haspopup="menu"
              :aria-expanded="newTemplateMenuOpen" :disabled="busy || !templateLoaded || !templateSaveAllowed"
              @click="toggleNewTemplateMenu">
              <span aria-hidden="true">＋</span> 新建模板
            </button>
            <div v-if="newTemplateMenuOpen" class="action-menu template-create-menu" role="menu">
              <button class="action-menu-item" role="menuitem" @click="createTemplate('default')">
                <span><strong>默认模板</strong><small>每条记录从新页开始</small></span>
              </button>
              <button class="action-menu-item" role="menuitem" @click="createTemplate('continuous')">
                <span><strong>连续模板</strong><small>多条记录纵向连续排版</small></span>
              </button>
              <button class="action-menu-item" role="menuitem" @click="createTemplate('labels')">
                <span><strong>标签模板</strong><small>按行列网格排列标签</small></span>
              </button>
            </div>
          </div>
        </section>

        <template v-if="presentation.showEditorPanel">
          <nav class="editor-tabs" aria-label="编辑工具">
            <button v-for="panel in EDITOR_PANELS" :key="panel" class="editor-tab"
              :class="{ 'editor-tab-active': activeEditorPanel === panel }"
              :aria-selected="activeEditorPanel === panel" @click="selectEditorPanel(panel)">
              {{ editorPanelLabels[panel] }}
            </button>
          </nav>

          <div v-if="activeEditorPanel === 'data-sources'" class="sidebar-section editor-content">
            <strong class="editor-group-title">字段</strong>
            <button v-for="field in fieldDataSources" :key="field.id" class="data-source-row" type="button"
              :aria-label="`复制数据源 ${field.name}`"
              @click="copyDataSource({ id: fieldDataSourceId(field.id), label: field.name })">
              <span class="source-main"><span class="source-symbol" aria-hidden="true">字</span><span>{{ field.name }}</span></span>
              <small>复制</small>
            </button>
            <span v-if="!fieldDataSources.length" class="empty-copy">当前表没有可用字段</span>
            <strong class="editor-group-title editor-group-system">系统</strong>
            <button class="data-source-row" type="button" aria-label="复制数据源 打印日期"
              @click="copyDataSource({ id: SYSTEM_PRINT_DATE_ID, label: '打印日期' })">
              <span class="source-main"><span class="source-symbol" aria-hidden="true">系</span><span>打印日期</span></span>
              <small>复制</small>
            </button>
          </div>
          <div v-if="activeEditorPanel === 'components'" class="sidebar-section editor-content">
            <p class="component-hint">拖动组件到右侧画布</p>
            <button v-for="component in components" :key="component.type" class="data-source-row component-row"
              draggable="true" @dragstart="startComponentDrag(component.type, $event)">
              <span class="source-main"><span class="source-symbol component-symbol" aria-hidden="true">{{ component.label.slice(0, 1) }}</span><span>{{ component.label }}</span></span>
              <small>拖入画布</small>
            </button>
          </div>
        </template>
      </aside>

      <section class="workspace-main">
        <header v-if="presentation.showWorkspaceToolbar" class="workspace-toolbar">
          <div class="workspace-heading">
            <h2>{{ workspaceSurface === 'batch-preview' ? '批量打印预览'
              : workspaceSurface === 'batch-edit' ? `编辑${currentTemplateName}` : currentTemplateName }}</h2>
            <span>{{ workspaceSurface === 'batch-preview'
              ? `${batchSession.committedRecordIds.length} 条记录 · ${renderedPages?.pages.length ?? 0} 页`
              : workspaceSurface === 'batch-edit'
                ? `保存后重新生成 ${batchSession.committedRecordIds.length} 条记录`
                : `${templateLayoutLabel(storedTemplate?.template)} · A4 纵向` }}</span>
          </div>
          <div class="workspace-actions">
            <button v-if="presentation.showEditTemplate" class="button button-secondary"
              :disabled="busy || !templateSelected || !templateSaveAllowed || (isBatchMode && !renderedPages)"
              @click="enterEditMode">编辑模板</button>
          </div>
        </header>

        <div class="canvas-stage">
          <section v-if="presentation.showInlineEditorPanel" class="batch-inline-editor-panel" aria-label="批量模板编辑操作区">
            <nav class="editor-tabs" aria-label="编辑工具">
              <button v-for="panel in EDITOR_PANELS" :key="panel" class="editor-tab"
                :class="{ 'editor-tab-active': activeEditorPanel === panel }"
                :aria-selected="activeEditorPanel === panel" @click="selectEditorPanel(panel)">
                {{ editorPanelLabels[panel] }}
              </button>
            </nav>
            <div v-if="activeEditorPanel === 'data-sources'" class="sidebar-section editor-content">
              <strong class="editor-group-title">字段</strong>
              <button v-for="field in fieldDataSources" :key="field.id" class="data-source-row" type="button"
                :aria-label="`复制数据源 ${field.name}`"
                @click="copyDataSource({ id: fieldDataSourceId(field.id), label: field.name })">
                <span class="source-main"><span class="source-symbol" aria-hidden="true">字</span><span>{{ field.name }}</span></span>
                <small>复制</small>
              </button>
              <span v-if="!fieldDataSources.length" class="empty-copy">当前表没有可用字段</span>
              <strong class="editor-group-title editor-group-system">系统</strong>
              <button class="data-source-row" type="button" aria-label="复制数据源 打印日期"
                @click="copyDataSource({ id: SYSTEM_PRINT_DATE_ID, label: '打印日期' })">
                <span class="source-main"><span class="source-symbol" aria-hidden="true">系</span><span>打印日期</span></span>
                <small>复制</small>
              </button>
            </div>
            <div v-if="activeEditorPanel === 'components'" class="sidebar-section editor-content">
              <p class="component-hint">拖动组件到右侧画布</p>
              <button v-for="component in components" :key="component.type" class="data-source-row component-row"
                draggable="true" @dragstart="startComponentDrag(component.type, $event)">
                <span class="source-main"><span class="source-symbol component-symbol" aria-hidden="true">{{ component.label.slice(0, 1) }}</span><span>{{ component.label }}</span></span>
                <small>拖入画布</small>
              </button>
            </div>
          </section>
          <div class="designer-host" :class="{ 'designer-host-preview': !presentation.showDesigner }"
            :aria-hidden="!presentation.showDesigner ? 'true' : 'false'"
            :inert="!presentation.showDesigner ? true : undefined">
            <print-designer ref="designerRef" lang="zh" @ready="markDesignerReady" />
          </div>
          <section v-if="presentation.showPreview" class="preview-surface" aria-label="打印预览">
            <div v-if="previewHtml" class="preview-paper-wrap">
              <iframe :srcdoc="previewHtml" :style="{ height: previewFrameHeight,
                width: `min(${renderedPages?.canvasWidth ?? 794}px, 100%)` }" title="打印预览"
                class="preview-frame" scrolling="no" />
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
      v-if="templateManagementDialog"
      class="decision-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="template-management-title"
      aria-describedby="template-management-description"
      @click.self="closeTemplateManagementDialog"
    >
      <div ref="templateManagementCardRef" class="decision-card template-management-card"
        @keydown.tab="trapTemplateManagementFocus">
        <h2 id="template-management-title">
          {{ templateManagementDialog.action === "rename" ? "重命名模板" : "删除模板" }}
        </h2>
        <template v-if="templateManagementDialog.action === 'rename'">
          <p id="template-management-description">输入一个便于识别的模板名称。</p>
          <label class="template-name-field">
            <span>模板名称</span>
            <input ref="templateRenameInputRef" v-model="templateRenameInput" class="template-name-input"
              aria-label="模板名称" maxlength="50" @keydown.enter.prevent="confirmTemplateManagement" />
          </label>
        </template>
        <p v-else id="template-management-description">删除“{{ templateManagementDialog.item.name }}”后无法恢复，其他模板不会受影响。</p>
        <div class="decision-actions">
          <button ref="templateManagementCancelRef" type="button" class="button button-quiet" :disabled="busy"
            @click="closeTemplateManagementDialog">取消</button>
          <button v-if="templateManagementDialog.action === 'rename'" type="button" class="button button-primary"
            :disabled="templateManagementConfirmDisabled" @click="confirmTemplateManagement">保存名称</button>
          <button v-else type="button" class="button button-danger" :disabled="templateManagementConfirmDisabled"
            @click="confirmTemplateManagement">确认删除</button>
        </div>
      </div>
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
  --ui-primary: #3370ff;
  --ui-primary-hover: #245bdb;
  --ui-primary-pressed: #1c4cba;
  --ui-primary-subtle: #e8f0ff;
  --ui-text: #1f2329;
  --ui-text-secondary: #646a73;
  --ui-text-tertiary: #8f959e;
  --ui-text-disabled: #c9cdd4;
  --ui-border: #dee0e3;
  --ui-divider: #ebecef;
  --ui-surface: #fff;
  --ui-surface-subtle: #f5f6f7;
  --ui-workspace: #f2f3f5;
  --ui-danger: #d83931;
  --ui-warning: #d46b08;
  height: 100dvh;
  min-height: 0;
  display: grid;
  grid-template-rows: 45px minmax(0, 1fr);
  overflow: hidden;
  background: var(--ui-surface);
  color: var(--ui-text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
}
.app-header {
  position: relative;
  z-index: 15;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 0 12px;
  border-bottom: 1px solid var(--ui-divider);
  background: var(--ui-surface);
}
.brand-block { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.brand-mark { width: 22px; height: 22px; display: grid; place-items: center; flex: 0 0 22px; border-radius: 5px; background: var(--ui-primary); color: #fff; font-size: 11px; font-weight: 700; }
.brand-block h1 { margin: 0; font-size: 15px; line-height: 22px; font-weight: 600; white-space: nowrap; }
.header-context { min-width: 0; display: flex; align-items: center; gap: 9px; overflow: hidden; color: var(--ui-text-secondary); font-size: 12px; white-space: nowrap; }
.header-context > span { overflow: hidden; text-overflow: ellipsis; }
.context-divider { flex: 0 0 auto; color: var(--ui-text-disabled); }
.header-actions, .workspace-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0; }
.app-header-edit { grid-template-columns: auto minmax(0, 1fr) auto; }
.edit-header-context { min-width: 0; display: flex; align-items: center; gap: 8px; }
.edit-header-context strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; }
.button {
  min-height: 32px;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 0 11px;
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  font-size: 13px;
  line-height: 30px;
  white-space: nowrap;
  cursor: pointer;
  touch-action: manipulation;
  transition: border-color .12s ease, background-color .12s ease, color .12s ease;
}
.button:hover:not(:disabled) { background: var(--ui-surface-subtle); }
.button:active:not(:disabled) { background: #e8eaed; }
.button:focus-visible,
.template-item:focus-visible,
.template-more-button:focus-visible,
.editor-tab:focus-visible,
.data-source-row:focus-visible,
.action-menu-item:focus-visible { outline: 2px solid rgba(51, 112, 255, .42); outline-offset: 1px; }
.button:disabled,
.template-item:disabled,
.template-more-button:disabled,
.data-source-row:disabled,
.action-menu-item:disabled { cursor: not-allowed; color: var(--ui-text-disabled); background: var(--ui-surface-subtle); border-color: var(--ui-divider); }
.button-primary { border-color: var(--ui-primary); background: var(--ui-primary); color: #fff; }
.button-primary:hover:not(:disabled) { border-color: var(--ui-primary-hover); background: var(--ui-primary-hover); }
.button-primary:active:not(:disabled) { border-color: var(--ui-primary-pressed); background: var(--ui-primary-pressed); }
.button-danger { border-color: var(--ui-danger); background: var(--ui-danger); color: #fff; }
.button-danger:hover:not(:disabled) { border-color: #b42318; background: #b42318; }
.button-secondary, .button-outline { border-color: var(--ui-border); background: #fff; }
.button-secondary:hover:not(:disabled), .button-outline:hover:not(:disabled) { border-color: #b7bac0; background: var(--ui-surface-subtle); }
.button-tertiary, .button-quiet { color: var(--ui-text-secondary); }
.back-button { justify-self: start; padding-left: 4px; }
.status-line {
  position: fixed;
  z-index: 40;
  left: 50%;
  bottom: 14px;
  max-width: min(620px, calc(100vw - 24px));
  min-height: 36px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 11px;
  border: 1px solid var(--ui-divider);
  border-radius: 7px;
  background: rgba(255, 255, 255, .98);
  box-shadow: 0 6px 18px rgba(31, 35, 41, .12);
  color: var(--ui-text-secondary);
  font-size: 12px;
  transform: translateX(-50%);
}
.status-line-error { border-color: #f2c4c1; background: #fff7f6; color: #8f2520; }
.status-indicator { width: 7px; height: 7px; flex: 0 0 7px; border: 2px solid #baceff; border-top-color: var(--ui-primary); border-radius: 50%; }
.status-line-error .status-indicator { border: 0; background: var(--ui-danger); }
.status-retry-button { border: 0; padding: 0 2px; background: transparent; color: var(--ui-primary); font: inherit; font-weight: 500; cursor: pointer; }
.status-retry-button:hover { color: var(--ui-primary-hover); }
.workspace {
  --workspace-sidebar-width: 188px;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: var(--workspace-sidebar-width) minmax(0, 1fr);
  overflow: hidden;
  background: var(--ui-surface);
}
.workspace-edit { --workspace-sidebar-width: 208px; }
.sidebar { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; border-right: 1px solid var(--ui-divider); background: #fafbfc; }
.sidebar-section { min-width: 0; padding: 12px 10px; }
.sidebar-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 28px; margin-bottom: 6px; }
.sidebar-title { font-size: 13px; font-weight: 600; }
.sidebar-count { color: var(--ui-text-tertiary); font-size: 11px; }
.template-section { flex: 1; min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; padding: 8px 7px; }
.template-section .sidebar-title-row { padding: 0 3px; }
.template-list { min-height: 0; overflow: auto; padding: 0 1px 8px; scrollbar-width: thin; }
.template-directory-row { position: relative; border: 1px solid transparent; border-radius: 6px; }
.template-directory-row + .template-directory-row { margin-top: 2px; }
.template-directory-row-active { border-color: #baceff; background: #fff; }
.template-directory-row-active::before { content: ""; position: absolute; z-index: 2; left: -1px; top: 8px; bottom: 8px; width: 3px; border-radius: 0 2px 2px 0; background: var(--ui-primary); }
.template-item { width: 100%; min-height: 46px; display: flex; align-items: center; border: 1px solid transparent; border-radius: 6px; padding: 7px 32px 7px 9px; background: transparent; color: inherit; text-align: left; font: inherit; cursor: pointer; }
.template-item:hover:not(:disabled) { background: var(--ui-surface-subtle); }
.template-item-active { background: #fff; }
.template-item-copy { min-width: 0; display: grid; gap: 2px; }
.template-item-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ui-text); font-size: 13px; font-weight: 500; }
.template-item-copy small { min-width: 0; display: flex; align-items: center; gap: 5px; overflow: hidden; color: var(--ui-text-tertiary); font-size: 11px; white-space: nowrap; }
.template-layout-label { overflow: hidden; text-overflow: ellipsis; }
.default-tag, .readonly-tag { flex: 0 0 auto; border-radius: 3px; padding: 0 4px; background: #eaf8ef; color: #1f6f43; font-size: 10px; line-height: 17px; }
.template-more-anchor { position: absolute; z-index: 4; top: 7px; right: 5px; }
.template-more-button { width: 30px; height: 30px; border: 0; border-radius: 5px; background: transparent; color: var(--ui-text-secondary); font: inherit; font-size: 17px; letter-spacing: 1px; cursor: pointer; opacity: 0; }
.template-directory-row:hover .template-more-button,
.template-directory-row:focus-within .template-more-button,
.template-directory-row-active .template-more-button { opacity: 1; }
.template-more-button:hover { background: var(--ui-surface-subtle); }
.template-create { position: relative; padding-top: 8px; border-top: 1px solid var(--ui-divider); }
.button-new-template { width: 100%; }
.action-menu { position: absolute; z-index: 25; min-width: 148px; padding: 5px; border: 1px solid var(--ui-divider); border-radius: 7px; background: #fff; box-shadow: 0 6px 18px rgba(31, 35, 41, .12); }
.action-menu-right { top: 36px; right: 0; }
.template-action-menu { top: 32px; right: -2px; }
.template-create-menu { right: 0; bottom: 40px; left: 0; width: auto; }
.template-create-menu .action-menu-item { align-items: flex-start; }
.template-create-menu .action-menu-item span { min-width: 0; }
.template-create-menu .action-menu-item small { white-space: normal; }
.action-menu-item { width: 100%; min-height: 32px; display: flex; align-items: center; border: 0; border-radius: 5px; padding: 6px 9px; background: transparent; color: var(--ui-text); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.action-menu-item:hover:not(:disabled) { background: var(--ui-surface-subtle); }
.action-menu-item > span { display: grid; gap: 1px; }
.action-menu-item strong { font-size: 13px; font-weight: 500; }
.action-menu-item small { color: var(--ui-text-tertiary); font-size: 11px; }
.action-menu-danger { margin-top: 4px; border-top: 1px solid var(--ui-divider); border-radius: 0 0 5px 5px; color: var(--ui-danger); }
.edit-more-anchor { position: relative; }
.batch-preview-sidebar { flex: 1; overflow: auto; padding: 10px 12px; }
.readonly-tag-editing { background: #fff7e8; color: #9a5f08; }
.batch-count { display: flex; align-items: baseline; gap: 5px; margin: 4px 0 12px; }
.batch-count strong { font-size: 24px; line-height: 28px; font-weight: 600; }
.batch-count span { color: var(--ui-text-secondary); font-size: 11px; }
.batch-metadata { margin: 0; }
.batch-metadata > div { min-width: 0; display: flex; justify-content: space-between; gap: 8px; padding: 7px 0; border-bottom: 1px solid var(--ui-divider); }
.batch-metadata dt { color: var(--ui-text-tertiary); font-size: 11px; }
.batch-metadata dd { min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 500; }
.batch-record-list { display: grid; gap: 4px; margin: 10px 0 0; padding: 0; list-style: none; }
.batch-record-list li { min-height: 32px; display: flex; align-items: center; border-radius: 5px; padding: 0 8px; background: var(--ui-surface-subtle); font-size: 11px; }
.batch-record-list span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.batch-remainder { display: block; margin-top: 7px; color: var(--ui-text-tertiary); font-size: 11px; }
.editor-tabs { flex: 0 0 44px; display: flex; gap: 16px; padding: 0 10px; border-bottom: 1px solid var(--ui-divider); background: #fff; }
.editor-tab { position: relative; border: 0; padding: 0 1px; background: transparent; color: var(--ui-text-secondary); font: inherit; font-size: 13px; cursor: pointer; }
.editor-tab-active { color: var(--ui-text); font-weight: 500; }
.editor-tab-active::after { content: ""; position: absolute; right: 0; bottom: 0; left: 0; height: 2px; background: var(--ui-primary); }
.editor-content { flex: 1; min-height: 0; overflow: auto; padding: 10px; background: #fff; scrollbar-width: thin; }
.editor-group-title { display: block; margin: 0 0 5px; color: var(--ui-text-tertiary); font-size: 11px; font-weight: 500; }
.editor-group-system { margin-top: 14px; }
.data-source-row { width: 100%; min-width: 0; min-height: 34px; display: flex; align-items: center; justify-content: space-between; gap: 8px; border: 0; border-radius: 5px; padding: 0 7px; background: transparent; color: var(--ui-text); font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.data-source-row:hover { background: var(--ui-surface-subtle); }
.source-main { min-width: 0; display: flex; align-items: center; gap: 7px; }
.source-main > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source-symbol { width: 20px; height: 20px; display: grid; place-items: center; flex: 0 0 20px; border-radius: 4px; background: #edf3ff; color: #4569a8; font-size: 10px; }
.component-symbol { background: #eef7f2; color: #397455; }
.data-source-row small { flex: 0 0 auto; color: var(--ui-text-tertiary); font-size: 10px; }
.data-source-row.component-row { cursor: grab; }
.data-source-row.component-row:active { cursor: grabbing; }
.empty-copy, .component-hint { color: var(--ui-text-tertiary); font-size: 11px; }
.component-hint { margin: 0 0 7px; }
.status-chip { display: inline-flex; width: fit-content; align-items: center; border: 1px solid var(--ui-border); border-radius: 4px; padding: 1px 5px; color: var(--ui-text-secondary); font-size: 10px; white-space: nowrap; }
.status-saved { border-color: #c7e5cf; color: #28723d; }
.status-unsaved { border-color: #f1d4a6; color: #9a5f08; }
.status-fallback { border-color: #f2c4c1; color: #9a302a; }
.workspace-main { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.workspace-toolbar { flex: 0 0 48px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 12px 0 16px; border-bottom: 1px solid var(--ui-divider); background: #fff; }
.workspace-heading { min-width: 0; display: grid; gap: 1px; }
.workspace-heading h2 { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 20px; font-weight: 600; }
.workspace-heading span { color: var(--ui-text-tertiary); font-size: 10px; line-height: 14px; }
.canvas-stage { position: relative; flex: 1; min-height: 0; overflow: hidden; background: var(--ui-workspace); }
.surface-batch-edit .workspace { --workspace-sidebar-width: 188px; }
.surface-batch-edit .canvas-stage { display: flex; }
.batch-inline-editor-panel { flex: 0 0 176px; min-width: 0; display: flex; flex-direction: column; border-right: 1px solid var(--ui-divider); background: #fff; }
.batch-inline-editor-panel .editor-tabs { flex: 0 0 44px; }
.batch-inline-editor-panel .editor-content { min-height: 0; }
.surface-batch-edit .designer-host { position: relative; inset: auto; flex: 1; min-width: 0; }
.designer-host { position: absolute; z-index: 1; inset: 0; overflow: hidden; background: #fff; opacity: 1; }
.designer-host-preview { opacity: 0; pointer-events: none; }
.designer-host print-designer { display: block; min-height: 100%; }
.preview-surface { position: absolute; z-index: 2; inset: 0; overflow: auto; padding: 18px 16px 0; background: var(--ui-workspace); scrollbar-width: thin; }
.preview-paper-wrap { min-height: 100%; display: flex; justify-content: center; align-items: flex-start; }
.preview-frame { display: block; width: min(794px, 100%); min-height: 1040px; overflow: hidden; border: 0; background: #fff; box-shadow: 0 2px 8px rgba(31, 35, 41, .11); }
.preview-empty { min-height: 100%; display: grid; place-content: center; justify-items: center; gap: 7px; padding: 24px; color: var(--ui-text-tertiary); font-size: 12px; text-align: center; }
.preview-empty strong { color: var(--ui-text-secondary); font-size: 14px; font-weight: 600; }
.decision-overlay { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 20px; background: rgba(31, 35, 41, .46); }
.decision-card { width: min(420px, 100%); border: 1px solid var(--ui-divider); border-radius: 8px; padding: 20px; background: #fff; box-shadow: 0 12px 32px rgba(31, 35, 41, .18); }
.decision-card h2 { margin: 0; font-size: 16px; font-weight: 600; }
.decision-card p { margin: 10px 0 20px; color: var(--ui-text-secondary); font-size: 13px; line-height: 1.6; }
.decision-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.template-management-card { width: min(400px, 100%); }
.template-name-field { display: grid; gap: 7px; margin: -4px 0 20px; color: var(--ui-text-secondary); font-size: 12px; }
.template-name-input { width: 100%; height: 34px; border: 1px solid var(--ui-border); border-radius: 6px; padding: 0 10px; background: #fff; color: var(--ui-text); font: inherit; font-size: 13px; outline: none; }
.template-name-input:hover { border-color: #8f959e; }
.template-name-input:focus { border-color: var(--ui-primary); box-shadow: 0 0 0 2px rgba(51, 112, 255, .14); }
@media (max-width: 760px) {
  .workspace { --workspace-sidebar-width: 164px; }
  .workspace-edit { --workspace-sidebar-width: 188px; }
  .surface-batch-edit .workspace { --workspace-sidebar-width: 164px; }
  .batch-inline-editor-panel { flex-basis: 148px; }
  .app-header { gap: 8px; padding: 0 9px; }
  .header-context { display: none; }
  .header-actions { gap: 4px; }
  .button { padding: 0 8px; }
  .template-section { padding-right: 5px; padding-left: 5px; }
  .template-item { padding-left: 7px; }
  .template-item-copy small .template-layout-label { display: none; }
  .preview-surface { padding: 12px 10px 0; }
}
@media (max-width: 560px) {
  .app-shell { min-width: 320px; }
  .brand-block h1 { display: none; }
  .workspace, .workspace-edit { grid-template-columns: 148px minmax(0, 1fr); }
  .header-actions .button { padding: 0 6px; font-size: 12px; }
  .workspace-toolbar { padding-right: 8px; padding-left: 10px; }
}
@media (prefers-reduced-motion: reduce) {
  .button { transition: none; }
}
</style>
