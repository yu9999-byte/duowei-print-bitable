<script setup lang="ts">
import { bitable } from "@lark-base-open/js-sdk";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  bindBatchEditProjection,
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
  renderedOutputPageCount,
  printRenderedPages,
  rememberCopiedDataSource,
  synchronizeBatchEditProjection,
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
import { automationTemplateSync } from "./host/automation-template-sync.ts";
import { RegistryConnectionRequiredError } from "./automation/registry-write-authorization.ts";
import { isDetailLinkField, type PrintJob } from "./core/print-job.ts";
import {
  generateBlankTemplate,
  generateLabelTemplate,
  generateTemplate,
} from "./core/template-generator.ts";
import {
  commitBatchPrintSession,
  createSinglePrintSession,
  shouldExitBatchOnTemplateSwitch,
  summarizeBatch,
  type BatchPrintSession,
} from "./core/batch-print-session.ts";
import { prepareBatchCandidate } from "./core/batch-candidate-transaction.ts";
import {
  createBatchRetryRequest,
  isBatchRetryRequestCurrent,
  type BatchRetryRequest,
} from "./core/batch-retry-request.ts";
import { commitBatchLayoutChange } from "./core/batch-layout-transaction.ts";
import { commitBatchTemplateEdit } from "./core/batch-template-edit.ts";
import { prepareTemplateCandidate } from "./core/template-candidate-transaction.ts";
import type { RenderedPrintJob } from "./engine/designer-adapter.ts";
import {
  buildDataSourceClipboardPayload,
  fieldDataSourceId,
  detailFieldDataSourceId,
  SYSTEM_PRINT_DATE_ID,
} from "./core/data-sources.ts";
import type { StoredTemplate, TemplateCollection } from "./core/template-repository.ts";
import {
  getBatchReadFailureFeedback,
} from "./components/batch-read-feedback.ts";
import { getBatchWorkspaceActionState } from "./components/batch-workspace-action-state.ts";
import { normalizeTemplateName } from "./components/template-management.ts";
import {
  DESIGNER_COMPONENT_GROUPS,
  type DesignerComponentType,
} from "./components/designer-components.ts";
import {
  BATCH_LAYOUT_OPTIONS,
  ensureBatchLayout,
  getBatchLayoutMode,
  mergeEditedBaseTemplate,
  mergeEditedBatchLayout,
  type BatchLayoutMode,
} from "./components/template-layout-choice.ts";
import {
  TEMPLATE_CREATION_OPTIONS,
  type TemplateCreateKind,
} from "./components/template-creation-choice.ts";
import { getWorkspacePresentation } from "./components/workspace-presentation.ts";
import { fitDesignerZoom, fitPreviewPaper } from "./components/preview-fit.ts";
import {
  isExplicitLayerActionControl,
  restoreImplicitSelectionLayering,
  withoutImplicitSelectionLayering,
} from "./core/designer-selection.ts";
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
  type EditorPanel,
  type TemplateStatus,
  type WorkspaceMode,
} from "./core/workspace.ts";

const designerRef = ref<DesignerElement | null>(null);
const previewSurfaceRef = ref<HTMLElement | null>(null);
const previewAvailableWidth = ref(0);
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
const pendingPreviewTemplateId = ref<string | null>(null);
const workspaceMode = ref<WorkspaceMode>(initialWorkspaceMode());
const activeEditorPanel = ref<EditorPanel>("data-sources");
const previewHtml = ref("");
const previewError = ref("");
const templateWarning = ref("");
const templateCreateError = ref("");
const lastTemplateCreateKind = ref<TemplateCreateKind>("automatic");
const batchRetryAvailable = ref(false);
const batchRetryRequest = ref<BatchRetryRequest | null>(null);
const designerReady = ref(false);
const batchSession = ref<BatchPrintSession>(createSinglePrintSession(null));
const renderedPages = ref<RenderedPrintJob | null>(null);
const batchPreviewStale = ref(false);
const status = ref("正在读取当前记录…");
const error = ref("");
const busy = ref(false);
const activeTemplateMenuId = ref<string | null>(null);
const newTemplateMenuOpen = ref(false);
const statusToastVisible = ref(false);
const automationConnectUrl = ref("");
let contextRevision = 0;
let candidateRender: Promise<RenderedPrintJob> | null = null;
let statusToastTimer: ReturnType<typeof setTimeout> | undefined;
let batchProjectionSyncTimer: ReturnType<typeof setTimeout> | undefined;
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
let pendingAutomationSync: (() => Promise<void>) | null = null;
let automationConnectionWindow: Window | null = null;
let automationConnectionProbeTimer: ReturnType<typeof setInterval> | undefined;
let explicitLayeringMutation = false;
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
const dataSourceSearch = ref("");
const copiedSourceId = ref("");
const fieldDataSources = computed(() => printJob.value?.table.fields ?? []);
const batchWorkspaceActions = computed(() => getBatchWorkspaceActionState({
  busy: busy.value,
  retryAvailable: batchRetryAvailable.value,
  workspaceMode: workspaceMode.value,
  templateLoaded: templateLoaded.value,
  hasRenderedPages: Boolean(renderedPages.value),
  session: batchSession.value,
}));
const renderedLayout = computed<"default" | "continuous" | "labels">(() =>
  renderedPages.value?.layout === "labels"
    ? "labels"
    : renderedPages.value?.layout === "continuous" ? "continuous" : "default");
const renderedLayoutLabel = computed(() => renderedLayout.value === "labels"
  ? "标签排版"
  : renderedLayout.value === "continuous" ? "连续排版" : "默认排版");
const currentBatchLayout = computed<BatchLayoutMode>(() => storedTemplate.value
  ? getBatchLayoutMode(storedTemplate.value.template)
  : renderedLayout.value);
const currentRecordLabel = computed(() => {
  return batchSession.value.mode === "batch"
    ? `已选 ${batchSession.value.committedRecordIds.length} 条`
    : "当前记录";
});
const isBatchMode = computed(() => batchWorkspaceActions.value.isBatchMode);
const workspaceSurface = computed(() => getWorkspaceSurface(workspaceMode.value, isBatchMode.value));
const presentation = computed(() => getWorkspacePresentation(workspaceSurface.value));
const showBatchRetry = computed(() => batchWorkspaceActions.value.retryVisible);
const previewPaperWidth = computed(() => renderedPages.value?.canvasWidth ?? 794);
const previewPaperHeight = computed(() => renderedPages.value ? renderedPreviewHeight(renderedPages.value) : 1040);
const previewScale = computed(() => fitPreviewPaper(previewPaperWidth.value, previewAvailableWidth.value));
const previewPaperStyle = computed(() => ({
  width: `${previewPaperWidth.value * previewScale.value}px`,
  height: `${previewPaperHeight.value * previewScale.value}px`,
}));
const previewFrameStyle = computed(() => ({
  width: `${previewPaperWidth.value}px`,
  height: `${previewPaperHeight.value}px`,
  transform: `scale(${previewScale.value})`,
}));
watch(previewSurfaceRef, (surface, _, onCleanup) => {
  if (!surface) return;
  const measure = () => {
    const style = getComputedStyle(surface);
    previewAvailableWidth.value = Math.max(0,
      surface.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
  };
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(surface);
  onCleanup(() => observer.disconnect());
});
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

watch(selectedTemplateId, (templateId) => {
  if (!batchRetryRequest.value || batchRetryRequest.value.templateId === templateId) return;
  batchRetryRequest.value = null;
  batchRetryAvailable.value = false;
});

function closeTransientMenus() {
  activeTemplateMenuId.value = null;
  newTemplateMenuOpen.value = false;
}

function toggleTemplateMenu(id: string) {
  newTemplateMenuOpen.value = false;
  activeTemplateMenuId.value = activeTemplateMenuId.value === id ? null : id;
}

function toggleNewTemplateMenu() {
  activeTemplateMenuId.value = null;
  newTemplateMenuOpen.value = !newTemplateMenuOpen.value;
}

function handleGlobalPointerDown(event: PointerEvent) {
  const target = event.target;
  if (target instanceof Element && target.closest(".menu-anchor")) return;
  closeTransientMenus();
}

function rememberAutomationConnection(error: Error, retry: () => Promise<void>): void {
  if (!(error instanceof RegistryConnectionRequiredError)) return;
  automationConnectUrl.value = error.connectUrl;
  pendingAutomationSync = retry;
}

function clearAutomationConnection(): void {
  if (automationConnectionProbeTimer) clearInterval(automationConnectionProbeTimer);
  automationConnectionProbeTimer = undefined;
  automationConnectUrl.value = "";
  pendingAutomationSync = null;
  automationConnectionWindow = null;
}

function connectAutomation(): void {
  if (!automationConnectUrl.value || busy.value) return;
  const popup = window.open(
    automationConnectUrl.value,
    "duowei-print-oauth",
    "popup=yes,width=520,height=680,resizable=yes,scrollbars=yes",
  );
  if (!popup) {
    error.value = "浏览器阻止了连接窗口，请允许多维打印打开窗口后重试";
    status.value = "自动化尚未连接";
    return;
  }
  automationConnectionWindow = popup;
  const bridge = automationTemplateSync?.bridge;
  if (automationConnectionProbeTimer) clearInterval(automationConnectionProbeTimer);
  automationConnectionProbeTimer = undefined;
  if (bridge) {
    const probe = () => {
      if (popup.closed) {
        if (automationConnectionProbeTimer) clearInterval(automationConnectionProbeTimer);
        automationConnectionProbeTimer = undefined;
        return;
      }
      bridge.probe(popup);
    };
    probe();
    automationConnectionProbeTimer = setInterval(probe, 500);
    status.value = "正在连接自动化模板服务…";
  } else {
    status.value = "请在新窗口完成飞书连接";
  }
}

async function handleAutomationConnectionMessage(event: MessageEvent): Promise<void> {
  if (automationTemplateSync?.bridge?.handleMessage(event)) return;
  if (!automationConnectUrl.value || !automationConnectionWindow) return;
  if (event.source !== automationConnectionWindow) return;
  if (event.origin !== new URL(automationConnectUrl.value).origin) return;
  const data = event.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return;
  const type = (data as Record<string, unknown>).type;
  if (type === "duowei-print:oauth-failed") {
    if (automationConnectionProbeTimer) clearInterval(automationConnectionProbeTimer);
    automationConnectionProbeTimer = undefined;
    automationTemplateSync?.bridge?.disconnect();
    error.value = typeof (data as Record<string, unknown>).message === "string"
      ? String((data as Record<string, unknown>).message)
      : "飞书连接未完成，请重试";
    status.value = "自动化尚未连接";
    automationConnectionWindow = null;
    return;
  }
  if (type !== "duowei-print:oauth-connected") return;
  if (automationConnectionProbeTimer) clearInterval(automationConnectionProbeTimer);
  automationConnectionProbeTimer = undefined;
  automationTemplateSync?.bridge?.connect(automationConnectionWindow);
  const retry = pendingAutomationSync;
  automationConnectionWindow = null;
  if (!retry) {
    clearAutomationConnection();
    return;
  }
  busy.value = true;
  error.value = "";
  status.value = "已连接，正在同步当前模板…";
  try {
    await retry();
    clearAutomationConnection();
    status.value = "自动化已连接，当前模板已同步";
  } catch (cause) {
    const failure = cause instanceof Error ? cause : new Error("自动化模板同步失败");
    rememberAutomationConnection(failure, retry);
    error.value = failure.message;
    status.value = automationConnectUrl.value ? "自动化连接未生效，请重试" : "自动化模板同步失败";
  } finally {
    busy.value = false;
  }
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
  batchRetryRequest.value = null;
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
    batchRetryRequest.value = null;
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

async function loadBatchCandidate(retryRequest?: BatchRetryRequest) {
  const revision = ++contextRevision;
  const previous = printJob.value;
  const designer = designerRef.value;
  let pending: Promise<RenderedPrintJob> | null = null;
  let previousDesignerTemplate: unknown = null;
  let savingSelection = false;
  busy.value = true;
  error.value = "";
  batchRetryAvailable.value = false;
  if (!retryRequest) batchRetryRequest.value = null;
  let candidateRequest = retryRequest ?? null;
  try {
    if (!designer || !previous || !templateLoaded.value) throw new Error("请先等待当前记录和模板加载完成");
    previousDesignerTemplate = getPersistentTemplateData(designer);
    const active = await getActiveSelection();
    await assertCurrentContext(active, revision);
    if (retryRequest && !isBatchRetryRequestCurrent(
      retryRequest,
      active,
      selectedTemplateId.value,
    )) {
      throw new Error("当前记录、数据表、视图或模板已变化，请重新选择打印记录");
    }
    const ids = retryRequest
      ? [...retryRequest.recordIds]
      : await selectRecordIds(active);
    if (!retryRequest) await assertCurrentContext(active, revision);
    if (!ids.length) {
      status.value = "未更改打印记录";
      return;
    }
    if (!candidateRequest) {
      if (!selectedTemplateId.value) throw new Error("请先选择打印模板");
      candidateRequest = createBatchRetryRequest(active, selectedTemplateId.value, ids);
    }
    const candidate = await prepareBatchCandidate({
      currentSession: batchSession.value,
      templateId: selectedTemplateId.value,
      requestedRecordIds: candidateRequest.recordIds,
      loadJob: (recordIds) => loadPrintJob(active, [...recordIds]),
      assertCurrent: () => assertCurrentContext(active, revision),
      renderJob: async (job) => {
        const canonical = storedTemplate.value?.template ?? previousDesignerTemplate;
        const mode = getBatchLayoutMode(canonical);
        const layout = ensureBatchLayout(
          canonical,
          mode,
          () => generateLabelTemplate(job),
          () => generateTemplate(job),
        );
        await bindPrintJob(designer, layout.effectiveTemplate, job);
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
    const context = { baseId: active.baseId, tableId: active.tableId };
    const existingId = storedTemplate.value?.id;
    const id = existingId ?? draftTemplateId.value ?? crypto.randomUUID();
    savingSelection = true;
    const updated = existingId
      ? await templateRepository.setBatchRecords(context, id, candidate.session.committedRecordIds,
        templateCollection.value.revision)
      : await templateRepository.upsert(context, previousDesignerTemplate, {
          id, name: currentTemplateName.value, expectedRevision: templateCollection.value.revision,
          savedBatchRecordIds: candidate.session.committedRecordIds,
        });
    await assertCurrentContext(active, revision);
    const saved = updated.templates.find((item) => item.id === id)!;
    templateCollection.value = updated;
    storedTemplate.value = saved;
    selectedTemplateId.value = id;
    draftTemplateId.value = null;
    draftOriginId.value = null;
    templateChecksum.value = saved.checksum;
    templateFallback.value = false;
    templateDirty.value = false;
    selection.value = active;
    printJob.value = candidate.job;
    batchSession.value = { ...candidate.session, templateId: id };
    renderedPages.value = candidate.rendered;
    previewHtml.value = candidate.previewHtml;
    batchPreviewStale.value = false;
    previewError.value = "";
    batchRetryRequest.value = null;
    workspaceMode.value = "preview";
    status.value = `已为当前模板保存 ${ids.length} 条记录，批次预览已生成`;
  } catch (cause) {
    if (revision === contextRevision) {
      if (designer && previous && previousDesignerTemplate) {
        try {
          await bindPrintJob(designer, previousDesignerTemplate, previous);
        } catch {
          // The committed preview remains available even if the hidden editor cannot be restored.
        }
      }
      const feedback = getBatchReadFailureFeedback(cause);
      batchRetryAvailable.value = savingSelection || feedback.retryAvailable;
      batchRetryRequest.value = batchRetryAvailable.value ? candidateRequest : null;
      error.value = savingSelection
        ? `打印记录未保存：${cause instanceof Error ? cause.message : "飞书存储写入失败"}`
        : feedback.error;
      status.value = savingSelection ? "记录选择未保存，原预览已保留" : feedback.status;
    }
  } finally {
    if (candidateRender === pending) candidateRender = null;
    if (revision === contextRevision) busy.value = false;
  }
}

async function retryBatchCandidate() {
  const request = batchRetryRequest.value;
  if (!request || busy.value) return;
  await loadBatchCandidate(request);
}

async function exitBatchMode() {
  if (!isBatchMode.value || busy.value) return;
  const revision = ++contextRevision;
  const designer = designerRef.value;
  const previous = printJob.value;
  const previousDesignerTemplate = designerRef.value
    ? getPersistentTemplateData(designerRef.value)
    : null;
  let pending: Promise<RenderedPrintJob> | null = null;
  busy.value = true;
  error.value = "";
  batchRetryAvailable.value = false;
  batchRetryRequest.value = null;
  try {
    if (!designer || !previous) return;
    const active = await getActiveSelection();
    const ids = getCurrentRecordIds(active);
    if (!ids.length) throw new Error("当前宿主记录不可用；原批次已保留");
    const job = await loadPrintJob(active, ids);
    await assertCurrentContext(active, revision);
    const canonical = storedTemplate.value?.template ?? previousDesignerTemplate;
    if (canonical) {
      const baseLayout = ensureBatchLayout(
        canonical,
        "default",
        () => generateLabelTemplate(job),
        () => generateTemplate(job),
      );
      await bindPrintJob(designer, baseLayout.effectiveTemplate, job);
    }
    pending = renderPrintJobCandidate(designer, previous, job, undefined,
      () => revision === contextRevision);
    candidateRender = pending;
    const rendered = await pending;
    await assertCurrentContext(active, revision);
    if (storedTemplate.value) {
      const updated = await templateRepository.setBatchRecords(
        { baseId: active.baseId, tableId: active.tableId },
        storedTemplate.value.id,
        [],
        templateCollection.value.revision,
      );
      templateCollection.value = updated;
      storedTemplate.value = updated.templates.find((item) => item.id === storedTemplate.value?.id) ?? null;
    }
    selection.value = active;
    printJob.value = job;
    batchSession.value = createSinglePrintSession(active.recordId);
    renderedPages.value = rendered;
    previewHtml.value = composeRenderedPrintPages(rendered);
    batchPreviewStale.value = false;
    previewError.value = "";
    workspaceMode.value = "preview";
    status.value = "已清除当前模板保存的打印记录，返回当前记录";
  } catch (cause) {
    if (revision === contextRevision) {
      if (designer && previous && previousDesignerTemplate) {
        try {
          await bindPrintJob(designer, previousDesignerTemplate, previous);
        } catch {
          // Keep the committed batch preview as the visible fallback.
        }
      }
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
    let selectedJob = job;
    let savedBatch: BatchPrintSession | null = null;
    let batchRestoreWarning = "";
    if (stored?.savedBatchRecordIds?.length) {
      try {
        selectedJob = await loadPrintJob(active, stored.savedBatchRecordIds);
        await assertCurrentContext(active, revision);
        const committed = commitBatchPrintSession(createSinglePrintSession(active.recordId), {
          recordIds: stored.savedBatchRecordIds,
          summaries: summarizeBatch(selectedJob),
          templateId: stored.id,
        });
        if (!committed.ok) throw new Error(committed.message);
        savedBatch = committed.session;
      } catch (cause) {
        if (revision !== contextRevision) throw cause;
        selectedJob = job;
        batchRestoreWarning = cause instanceof Error ? cause.message : "保存的打印记录无法读取";
      }
    }
    const singleTemplate = stored
      ? ensureBatchLayout(
        stored.template,
        savedBatch ? getBatchLayoutMode(stored.template) : "default",
        () => generateLabelTemplate(selectedJob),
        () => generateTemplate(selectedJob),
      ).effectiveTemplate
      : undefined;
    const bindWarning = await bindStoredTemplateOrFallback(designerRef.value, singleTemplate, selectedJob);
    await assertCurrentContext(active, revision);
    warning ??= bindWarning;
    printJob.value = selectedJob;
    batchSession.value = savedBatch ?? createSinglePrintSession(active.recordId);
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
    templateWarning.value = batchRestoreWarning
      ? `保存的打印记录暂时无法恢复：${batchRestoreWarning}；模板仍可用于当前记录`
      : warning
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
      const rendered = await renderPrintJobPages(designerRef.value, selectedJob);
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

function captureTemplateBaseline(template?: unknown) {
  templateBaseline = template === undefined
    ? readTemplateSnapshot()
    : JSON.stringify(template);
  explicitLayeringMutation = false;
}

function isExplicitLayeringAction(event: Event): boolean {
  return (typeof event.composedPath === "function" ? event.composedPath() : [event.target])
    .some((item) => {
      if (!(item instanceof Element)) return false;
      return isExplicitLayerActionControl({
        tagName: item.tagName,
        role: item.getAttribute("role"),
        ariaLabel: item.getAttribute("aria-label"),
        title: item.getAttribute("title"),
        text: item.textContent,
      });
    });
}

function handleDocumentCapture(event: Event) {
  if (workspaceMode.value === "edit" && isExplicitLayeringAction(event)) {
    explicitLayeringMutation = true;
  }
}

function refreshTemplateDirtyState() {
  if (workspaceMode.value !== "edit") return templateDirty.value;
  templateDirty.value = getTemplateDirtyState({
    hasDraft: Boolean(draftTemplateId.value),
    baseline: templateBaseline,
    snapshot: withoutImplicitSelectionLayering(
      readTemplateSnapshot(),
      templateBaseline,
      explicitLayeringMutation,
    ),
    dirty: templateDirty.value,
  });
  return templateDirty.value;
}

async function flushBatchProjectionSync(): Promise<boolean> {
  if (batchProjectionSyncTimer) {
    clearTimeout(batchProjectionSyncTimer);
    batchProjectionSyncTimer = undefined;
  }
  if (workspaceSurface.value !== "batch-edit" || !designerRef.value) return false;
  try {
    const synchronized = await synchronizeBatchEditProjection(designerRef.value);
    refreshTemplateDirtyState();
    return synchronized;
  } catch (cause) {
    const syncError = cause instanceof Error ? cause : new Error("批量模板同步失败");
    error.value = syncError.message;
    status.value = "批量模板修改未同步，请撤销冲突修改后重试";
    throw syncError;
  }
}

function scheduleBatchProjectionSync() {
  if (workspaceSurface.value !== "batch-edit") return;
  if (batchProjectionSyncTimer) clearTimeout(batchProjectionSyncTimer);
  batchProjectionSyncTimer = setTimeout(() => {
    batchProjectionSyncTimer = undefined;
    void flushBatchProjectionSync().catch(() => undefined);
  }, 80);
}

function installDesignerDirtyTracking() {
  const designer = designerRef.value;
  if (!designer) return () => undefined;
  const liveEvents = ["input", "keyup"];
  const committedEvents = ["change", "focusout", "pointerup", "click", "drop"];
  const handleLiveInteraction = () => queueMicrotask(refreshTemplateDirtyState);
  const handleCommittedInteraction = () => setTimeout(() => {
    refreshTemplateDirtyState();
    scheduleBatchProjectionSync();
  }, 0);
  liveEvents.forEach((eventName) => designer.addEventListener(eventName, handleLiveInteraction));
  committedEvents.forEach((eventName) => designer.addEventListener(eventName, handleCommittedInteraction));
  return () => {
    liveEvents.forEach((eventName) => designer.removeEventListener(eventName, handleLiveInteraction));
    committedEvents.forEach((eventName) => designer.removeEventListener(eventName, handleCommittedInteraction));
  };
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
    if (batchEditing) await flushBatchProjectionSync();
    const id = draftTemplateId.value ?? (selectedTemplateId.value === "automatic"
      ? crypto.randomUUID() : selectedTemplateId.value);
    if (!id) throw new Error("请先选择模板");
    const editedTemplate = restoreImplicitSelectionLayering(
      getPersistentTemplateData(designerRef.value),
      templateBaseline,
      explicitLayeringMutation,
    );
    const canonicalTemplate = draftTemplateId.value
      ? editedTemplate
      : storedTemplate.value?.template ?? editedTemplate;
    const persistentTemplate = batchEditing
      ? mergeEditedBatchLayout(canonicalTemplate, editedTemplate, currentBatchLayout.value)
      : mergeEditedBaseTemplate(canonicalTemplate, editedTemplate);
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
    let automationSyncFailure: Error | null = null;
    if (automationTemplateSync) {
      const templateSync = automationTemplateSync;
      try {
        await templateSync.sync({
          baseToken: active.baseId,
          tableId: active.tableId,
        }, saved);
        clearAutomationConnection();
      } catch (cause) {
        automationSyncFailure = cause instanceof Error
          ? cause
          : new Error("模板已保存，但自动化同步失败");
        rememberAutomationConnection(automationSyncFailure, () => templateSync.sync({
          baseToken: active.baseId,
          tableId: active.tableId,
        }, saved).then(() => undefined));
      }
    }
    templateCollection.value = updated;
    selectedTemplateId.value = id;
    draftTemplateId.value = null;
    draftOriginId.value = null;
    templateChecksum.value = saved.checksum;
    storedTemplate.value = saved;
    templateFallback.value = false;
    templateDirty.value = false;
    templateCreateError.value = "";
    // The editor can keep a bound runtime projection after persistence. Compare
    // future edits with that same live projection, not the stored canonical data.
    captureTemplateBaseline();
    status.value = "模板已保存（未写入当前记录值）";
    if (batchEditing && renderFailure) {
      batchPreviewStale.value = true;
      error.value = `模板已保存，但批量预览刷新失败：${renderFailure.message}`
        + (automationSyncFailure ? `；${automationSyncFailure.message}` : "");
      status.value = automationSyncFailure
        ? "模板已保存，但批量预览刷新和自动化同步失败"
        : "模板已保存，原批量预览仍保留；请重试刷新";
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
    if (automationSyncFailure) {
      error.value = automationSyncFailure.message;
      status.value = "模板已保存，但自动化同步失败";
    } else if (automationTemplateSync) {
      status.value = renderedBatch
        ? `模板已保存并按 ${batchSession.value.committedRecordIds.length} 条记录刷新，可用于自动化`
        : "模板已保存，可用于自动化";
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

function templateLayoutLabel(template: unknown) {
  const mode = getBatchLayoutMode(template);
  return BATCH_LAYOUT_OPTIONS.find((option) => option.kind === mode)?.label ?? "默认排版";
}

async function createTemplate(
  kind: TemplateCreateKind = "automatic",
) {
  if (workspaceMode.value !== "preview" || !designerRef.value || !printJob.value
      || !selection.value || !templateLoaded.value || busy.value) return;
  closeTransientMenus();
  const designer = designerRef.value;
  const previousJob = printJob.value;
  let job = previousJob;
  const active = selection.value;
  const revision = contextRevision;
  const draftId = crypto.randomUUID();
  const exitsOwnedBatch = shouldExitBatchOnTemplateSwitch(batchSession.value, draftId);
  lastTemplateCreateKind.value = kind;
  busy.value = true;
  error.value = "";
  templateCreateError.value = "";
  try {
    if (exitsOwnedBatch) {
      const currentIds = getCurrentRecordIds(active);
      if (!currentIds.length) throw new Error("当前宿主记录不可用；原批次已保留");
      job = await loadPrintJob(active, currentIds);
      await assertCurrentContext(active, revision);
    }
    const initialTemplate = kind === "blank"
      ? generateBlankTemplate(job)
      : generateTemplate(job);
    const previousTemplate = getPersistentTemplateData(designer);
    const candidate = await prepareTemplateCandidate({
      template: initialTemplate,
      load: async (candidate) => {
        await bindPrintJob(designer, candidate, job);
        await assertCurrentContext(active, revision);
      },
      render: async () => {
        const rendered = await renderPrintJobPages(
          designer,
          job,
          undefined,
          () => revision === contextRevision,
        );
        await assertCurrentContext(active, revision);
        return rendered;
      },
      restore: async () => {
        if (revision !== contextRevision) return;
        await bindPrintJob(designer, previousTemplate, previousJob);
      },
    });
    if (exitsOwnedBatch) {
      printJob.value = job;
      batchSession.value = createSinglePrintSession(active.recordId);
      renderedPages.value = candidate.rendered;
      previewHtml.value = composeRenderedPrintPages(candidate.rendered);
      batchPreviewStale.value = false;
    }
    draftOriginId.value = selectedTemplateId.value;
    draftTemplateId.value = draftId;
    const prefix = kind === "blank" ? "空白模板" : "自动模板";
    draftTemplateName.value = `${prefix} ${templateCollection.value.templates.length + 1}`;
    selectedTemplateId.value = draftTemplateId.value;
    templateDirty.value = true;
    captureTemplateBaseline();
    workspaceMode.value = "edit";
    activeEditorPanel.value = "data-sources";
    const createdStatus = kind === "blank" ? "已创建未保存空白模板草稿" : "已创建未保存自动模板草稿";
    status.value = exitsOwnedBatch ? `已退出原模板批量；${createdStatus}` : createdStatus;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "新模板创建失败";
    error.value = message;
    templateCreateError.value = message;
    status.value = "新模板创建失败";
  } finally {
    busy.value = false;
  }
}

async function changeBatchLayout(mode: BatchLayoutMode) {
  if (!isBatchMode.value || !designerRef.value || !printJob.value || !selection.value) return;
  if (!storedTemplate.value || selectedTemplateId.value === "automatic" || draftTemplateId.value) {
    status.value = "请先保存当前模板，再设置批量排版";
    return;
  }
  if (mode === currentBatchLayout.value) return;
  if (busy.value) return;
  if (workspaceMode.value === "edit" && refreshTemplateDirtyState()) {
    status.value = "请先保存当前模板修改，再切换批量排版";
    return;
  }

  const designer = designerRef.value;
  const job = printJob.value;
  const active = selection.value;
  const revision = contextRevision;
  const previous = storedTemplate.value;
  const previousMode = getBatchLayoutMode(previous.template);
  const previousLayout = ensureBatchLayout(
    previous.template,
    previousMode,
    () => generateLabelTemplate(job),
    () => generateTemplate(job),
  );
  const candidate = ensureBatchLayout(
    previous.template,
    mode,
    () => generateLabelTemplate(job),
    () => generateTemplate(job),
  );
  const wasEditing = workspaceMode.value === "edit";
  busy.value = true;
  error.value = "";
  try {
    const committed = await commitBatchLayoutChange({
      applyCandidate: () => bindPrintJob(designer, candidate.effectiveTemplate, job),
      renderCandidate: async () => {
        const rendered = await renderPrintJobPages(
          designer,
          job,
          undefined,
          () => revision === contextRevision,
        );
        await assertCurrentContext(active, revision);
        return rendered;
      },
      prepareEditableProjection: wasEditing
        ? () => bindBatchEditProjection(designer, candidate.effectiveTemplate, job, mode)
        : undefined,
      persistCandidate: () => templateRepository.upsert(
        { baseId: active.baseId, tableId: active.tableId },
        candidate.persistentTemplate,
        {
          id: previous.id,
          name: previous.name,
          expectedRevision: templateCollection.value.revision,
        },
      ),
      restoreCommitted: async () => {
        if (revision !== contextRevision) return;
        await bindPrintJob(designer, previousLayout.effectiveTemplate, job);
        if (wasEditing) {
          await bindBatchEditProjection(designer, previousLayout.effectiveTemplate, job, previousMode);
        }
      },
    });
    await assertCurrentContext(active, revision);
    const updated = committed.saved;
    const saved = updated.templates.find((item) => item.id === previous.id);
    if (!saved) throw new Error("批量排版已保存但模板目录未返回当前模板");
    templateCollection.value = updated;
    storedTemplate.value = saved;
    templateChecksum.value = saved.checksum;
    renderedPages.value = committed.rendered;
    previewHtml.value = composeRenderedPrintPages(committed.rendered);
    previewError.value = "";
    batchPreviewStale.value = false;
    if (wasEditing) {
      captureTemplateBaseline();
      templateDirty.value = false;
    }
    status.value = `已将当前模板切换为${BATCH_LAYOUT_OPTIONS.find((item) => item.kind === mode)?.label}`;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "批量排版切换失败";
    status.value = "排版未切换，原模板和批量预览已保留";
  } finally {
    if (revision === contextRevision) busy.value = false;
  }
}

async function selectTemplate(id: string): Promise<boolean> {
  if (workspaceMode.value !== "preview" || !templateLoaded.value
    || !selection.value || !designerRef.value
    || !printJob.value || busy.value) return false;
  closeTransientMenus();
  const designer = designerRef.value;
  const previousJob = printJob.value;
  let job = previousJob;
  const active = selection.value;
  const revision = contextRevision;
  const target = id === "automatic"
    ? null
    : templateCollection.value.templates.find((item) => item.id === id) ?? null;
  busy.value = true;
  error.value = "";
  previewError.value = "";
  templateCreateError.value = "";
  try {
    if (id !== "automatic" && !target) throw new Error("所选模板已不存在，请重新加载");
    let savedIds = target?.savedBatchRecordIds ?? [];
    let restoreWarning = "";
    const keepingCurrentBatch = batchSession.value.mode === "batch" && batchSession.value.templateId === id;
    if (savedIds.length) {
      try {
        job = keepingCurrentBatch && savedIds.join("\u0000") === batchSession.value.committedRecordIds.join("\u0000")
          ? previousJob : await loadPrintJob(active, savedIds);
        await assertCurrentContext(active, revision);
      } catch (cause) {
        if (revision !== contextRevision) throw cause;
        savedIds = [];
        restoreWarning = cause instanceof Error ? cause.message : "保存的打印记录无法读取";
      }
    }
    if (!savedIds.length && batchSession.value.mode === "batch") {
      const currentIds = getCurrentRecordIds(active);
      if (!currentIds.length) throw new Error("当前宿主记录不可用；原批次已保留");
      job = await loadPrintJob(active, currentIds);
      await assertCurrentContext(active, revision);
    }
    const previousTemplate = getPersistentTemplateData(designer);
    const canonicalTemplate = target?.template ?? generateTemplate(job);
    const selectedMode = savedIds.length
      ? getBatchLayoutMode(canonicalTemplate) : "default";
    const explicitTemplate = ensureBatchLayout(
      canonicalTemplate,
      selectedMode,
      () => generateLabelTemplate(job),
      () => generateTemplate(job),
    ).effectiveTemplate;
    const candidate = await prepareTemplateCandidate({
      template: explicitTemplate,
      load: async (template) => {
        await bindPrintJob(designer, template, job);
        await assertCurrentContext(active, revision);
      },
      render: async () => {
        const rendered = await renderPrintJobPages(
          designer,
          job,
          undefined,
          () => revision === contextRevision,
        );
        await assertCurrentContext(active, revision);
        return rendered;
      },
      restore: async () => {
        if (revision !== contextRevision) return;
        await bindPrintJob(designer, previousTemplate, previousJob);
      },
    });
    printJob.value = job;
    if (savedIds.length) {
      const committed = commitBatchPrintSession(createSinglePrintSession(active.recordId), {
        recordIds: savedIds, summaries: summarizeBatch(job), templateId: id,
      });
      if (!committed.ok) throw new Error(committed.message);
      batchSession.value = committed.session;
    } else {
      batchSession.value = createSinglePrintSession(active.recordId);
    }
    storedTemplate.value = target;
    selectedTemplateId.value = id;
    draftTemplateId.value = null;
    draftTemplateName.value = "";
    draftOriginId.value = null;
    templateFallback.value = false;
    templateChecksum.value = target?.checksum ?? null;
    templateSaveAllowed.value = true;
    templateDirty.value = false;
    captureTemplateBaseline();
    templateWarning.value = restoreWarning
      ? `当前模板保存的打印记录暂时不可用：${restoreWarning}；已显示当前记录`
      : "";
    renderedPages.value = candidate.rendered;
    previewHtml.value = composeRenderedPrintPages(candidate.rendered);
    batchPreviewStale.value = false;
    status.value = restoreWarning
      ? "已切换模板；保存的打印记录暂时不可用"
      : isBatchMode.value
      ? `已恢复当前模板保存的 ${batchSession.value.committedRecordIds.length} 条记录`
      : "已切换模板并刷新当前记录预览";
    return true;
  } catch (cause) {
    if (revision === contextRevision) {
      error.value = cause instanceof Error ? cause.message : "模板切换失败";
      status.value = "模板未切换，原预览已保留";
    }
    return false;
  } finally {
    if (revision === contextRevision) busy.value = false;
  }
}

async function updateDirectory(
  action: "rename" | "remove" | "default",
  item: StoredTemplate,
  renameTo?: string,
): Promise<boolean> {
  if (workspaceMode.value !== "preview" || !selection.value || busy.value) return false;
  closeTransientMenus();
  const active = selection.value;
  const revision = contextRevision;
  let nextSelection: string | null = null;
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
    let automationSyncFailure: Error | null = null;
    if (automationTemplateSync && action !== "default") {
      const templateSync = automationTemplateSync;
      try {
        if (action === "remove") {
          await templateSync.remove({
            baseToken: active.baseId,
            tableId: active.tableId,
          }, item);
        } else {
          const renamed = updated.templates.find((template) => template.id === item.id);
          if (!renamed) throw new Error("重命名后的模板不存在");
          await templateSync.sync({
            baseToken: active.baseId,
            tableId: active.tableId,
          }, renamed);
        }
        clearAutomationConnection();
      } catch (cause) {
        automationSyncFailure = cause instanceof Error
          ? cause
          : new Error("模板目录已更新，但自动化同步失败");
        const retry = action === "remove"
          ? () => templateSync.remove({
              baseToken: active.baseId,
              tableId: active.tableId,
            }, item).then(() => undefined)
          : () => {
              const renamed = updated.templates.find((template) => template.id === item.id);
              if (!renamed) return Promise.reject(new Error("重命名后的模板不存在"));
              return templateSync.sync({
                baseToken: active.baseId,
                tableId: active.tableId,
              }, renamed).then(() => undefined);
            };
        rememberAutomationConnection(automationSyncFailure, retry);
      }
    }
    templateCollection.value = updated;
    if (automationSyncFailure) {
      error.value = automationSyncFailure.message.replace(/^模板已保存/, "模板目录已更新");
      status.value = "模板目录已更新，但自动化同步失败";
    } else {
      status.value = action === "rename" ? "模板已重命名" : action === "remove" ? "模板已删除" : "默认模板已更新";
    }
    if (action === "remove" && selectedTemplateId.value === item.id) {
      nextSelection = updated.defaultId ?? "automatic";
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "模板目录操作失败";
    status.value = "模板目录未更新";
    return false;
  } finally {
    busy.value = false;
  }
  if (nextSelection) return selectTemplate(nextSelection);
  return true;
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

function requestTemplateSelection(id: string) {
  if (selectedTemplateId.value === id) return;
  if (shouldGuardUnsavedNavigation(refreshTemplateDirtyState())) {
    pendingPreviewTemplateId.value = id;
    decisionDialog.value = "leave";
    status.value = "切换模板前，请先处理未保存的模板修改";
    return;
  }
  void selectTemplate(id);
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

async function enterEditMode() {
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
  const designer = designerRef.value;
  const job = printJob.value;
  const active = selection.value;
  const revision = contextRevision;
  if (!designer || !job) return;
  busy.value = true;
  error.value = "";
  try {
    const persistentTemplate = getPersistentTemplateData(designer);
    const canvasWidth = Number((persistentTemplate.canvasSize as { width?: unknown } | undefined)?.width);
    const editTemplate = {
      ...persistentTemplate,
      zoom: fitDesignerZoom(canvasWidth, designer.clientWidth, Number(persistentTemplate.zoom) || 1),
    };
    if (isBatchMode.value) {
      await bindBatchEditProjection(designer, editTemplate, job, renderedLayout.value);
    } else {
      await bindPrintJob(designer, editTemplate, job);
    }
    if (active) await assertCurrentContext(active, revision);
    workspaceMode.value = "edit";
    activeEditorPanel.value = "data-sources";
    // The designer opens its floating properties panel over the right side of
    // the paper. Start with it closed so the fitted sheet is actually visible.
    await nextTick();
    window.dispatchEvent(new Event("designer:close-properties-panel"));
    captureTemplateBaseline();
    status.value = isBatchMode.value
      ? `已加载 ${job.documents.length} 条记录`
      : "已进入编辑模式";
  } catch (cause) {
    try {
      await bindPrintJob(designer, getPersistentTemplateData(designer), job);
    } catch {
      // The committed preview remains visible even if the hidden designer cannot be restored.
    }
    error.value = cause instanceof Error ? cause.message : "模板编辑画布加载失败";
    status.value = "仍保留当前打印预览";
  } finally {
    if (revision === contextRevision) busy.value = false;
  }
}

async function applyPreviewMode(): Promise<boolean> {
  const refreshed = await refreshPreview();
  if (refreshed && workspaceMode.value === "edit") {
    workspaceMode.value = "preview";
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
    const storedEffective = storedTemplate.value
      ? ensureBatchLayout(
        storedTemplate.value.template,
        getBatchLayoutMode(storedTemplate.value.template),
        () => generateLabelTemplate(printJob.value!),
        () => generateTemplate(printJob.value!),
      ).effectiveTemplate
      : undefined;
    const warning = await bindStoredTemplateOrFallback(
      designerRef.value,
      storedEffective,
      printJob.value,
    );
    if (warning) throw new Error(warning);
    if (draftTemplateId.value) {
      selectedTemplateId.value = draftOriginId.value ?? "automatic";
      draftTemplateId.value = null;
      draftTemplateName.value = "";
      draftOriginId.value = null;
    }
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
      pendingPreviewTemplateId.value = null;
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
  const requestedTemplateId = pendingPreviewTemplateId.value;
  pendingPreviewTemplateId.value = null;
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
  if (action === "leave" && requestedTemplateId) {
    workspaceMode.value = "preview";
    await selectTemplate(requestedTemplateId);
  } else if (action === "leave" && workspaceMode.value === "edit") await applyPreviewMode();
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
    copiedSourceId.value = source.id;
    window.setTimeout(() => { if (copiedSourceId.value === source.id) copiedSourceId.value = ""; }, 1800);
    if (designerRef.value) rememberCopiedDataSource(designerRef.value, payload);
    status.value = source.id.includes(".__duowei_column_") ? `已复制“${source.label}”，请双击表格数据行的单元格后粘贴` : `已复制“${source.label}”，请选中文本组件后粘贴`;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "数据源复制失败";
    status.value = "数据源复制失败";
  }
}

function startComponentDrag(type: DesignerComponentType, event: DragEvent) {
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
  window.addEventListener("message", handleAutomationConnectionMessage);
  document.addEventListener("pointerdown", handleGlobalPointerDown);
  document.addEventListener("keydown", handleGlobalKeydown);
    document.addEventListener("click", handleDocumentCapture, true);
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
  window.removeEventListener("message", handleAutomationConnectionMessage);
  document.removeEventListener("pointerdown", handleGlobalPointerDown);
  document.removeEventListener("keydown", handleGlobalKeydown);
  document.removeEventListener("click", handleDocumentCapture, true);
  if (statusToastTimer) clearTimeout(statusToastTimer);
  if (batchProjectionSyncTimer) clearTimeout(batchProjectionSyncTimer);
  if (automationConnectionProbeTimer) clearInterval(automationConnectionProbeTimer);
  automationTemplateSync?.bridge?.dispose();
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
    <header class="app-header">
      <div class="brand-block" aria-label="多维打印">
        <span class="brand-mark" aria-hidden="true">印</span>
        <h1>多维打印</h1>
      </div>
    </header>

    <div v-if="showStatusFeedback" class="status-line" :class="{ 'status-line-error': hasFeedbackError, 'status-line-loading': busy && !hasFeedbackError }"
      :role="hasFeedbackError ? 'alert' : 'status'" aria-live="polite">
      <svg class="status-indicator" viewBox="0 0 20 20" aria-hidden="true">
        <template v-if="hasFeedbackError">
          <circle cx="10" cy="10" r="9" fill="currentColor" />
          <path d="M10 5.5v5M10 14v.1" stroke="white" stroke-width="1.8" stroke-linecap="round" />
        </template>
        <circle v-else-if="busy" cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="34 14" />
        <template v-else>
          <circle cx="10" cy="10" r="9" fill="currentColor" />
          <path d="m6 10 2.5 2.5L14 7" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </template>
      </svg>
      <span>{{ status }}</span>
      <span v-if="templateWarning">模板：{{ templateWarning }}</span>
      <span v-if="previewError">预览：{{ previewError }}</span>
      <span v-if="error">{{ error }}</span>
      <button v-if="showBatchRetry" class="status-retry-button" type="button"
        @click="retryBatchCandidate">重试批量读取</button>
      <button v-if="automationConnectUrl" class="status-retry-button" type="button"
        :disabled="busy" @click="connectAutomation">连接自动化</button>
    </div>

    <section class="workspace" :class="`workspace-${workspaceMode}`">
      <aside class="sidebar" :aria-label="presentation.showTemplateDirectory ? '模板目录' : '编辑操作区'">
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
              @click="requestTemplateSelection('automatic')"
            >
              <span class="template-item-copy">
                <strong>自动模板</strong>
                <small>{{ templateFallback ? '只读回退' : '未保存' }}</small>
              </span>
            </button>
            <div v-for="item in templateCollection.templates" :key="item.id" class="template-directory-row"
              :class="{ 'template-directory-row-active': selectedTemplateId === item.id }">
              <button class="template-item" :class="{ 'template-item-active': selectedTemplateId === item.id }"
                :disabled="busy" @click="requestTemplateSelection(item.id)">
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
              <button v-for="option in TEMPLATE_CREATION_OPTIONS" :key="option.kind"
                class="action-menu-item" role="menuitem" @click="createTemplate(option.kind)">
                <span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
              </button>
            </div>
            <div v-if="templateCreateError" class="template-create-error" role="alert">
              <span>{{ templateCreateError }}</span>
              <button type="button" :disabled="busy" @click="createTemplate(lastTemplateCreateKind)">重试创建</button>
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

          <div v-if="activeEditorPanel === 'data-sources'" class="sidebar-section editor-content source-panel">
            <label class="source-search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><input v-model="dataSourceSearch" placeholder="搜索字段" aria-label="搜索数据源字段" /></label>
            <strong class="editor-group-title source-section-heading">当前记录 <span>{{ fieldDataSources.length }} 个字段</span></strong>
            <template v-for="field in fieldDataSources.filter(item => !dataSourceSearch.trim() || item.name.includes(dataSourceSearch.trim()) || (item.detailColumns ?? item.arrayColumns ?? []).some(column => column.header.includes(dataSourceSearch.trim())))" :key="field.id">
            <details v-if="isDetailLinkField(field)" class="detail-source-group" :open="dataSourceSearch.trim() ? true : undefined">
              <summary class="data-source-row detail-source-summary">
                <span class="source-main"><svg class="source-type-icon source-link-icon" viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="3" width="10" height="7" rx="3"/><rect x="8" y="10" width="10" height="7" rx="3"/><path d="m8 8 4 4"/></svg><span>{{ field.name }}</span></span>
                <small class="detail-source-count">{{ (field.detailColumns ?? field.arrayColumns ?? []).length }} 字段</small><svg class="source-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg>
              </summary>
              <div class="detail-source-fields">
              <button v-for="column in (field.detailColumns ?? field.arrayColumns ?? []).filter(item => !dataSourceSearch.trim() || field.name.includes(dataSourceSearch.trim()) || item.header.includes(dataSourceSearch.trim()))" :key="column.field"
                class="data-source-row detail-source-child" type="button" :disabled="busy"
                :aria-label="`复制明细字段 ${field.name}.${column.header}`"
                @click="copyDataSource({ id: detailFieldDataSourceId(field.id, column.field), label: `${field.name}.${column.header}` })">
                <span class="detail-field-copy"><span class="source-main"><span class="source-type-letter" aria-hidden="true">A</span><span :title="column.header">{{ column.header }}</span></span><span class="source-placeholder">[{{ column.header }}]</span></span>
                <svg class="source-copy-icon" viewBox="0 0 20 20" aria-hidden="true"><path v-if="copiedSourceId === detailFieldDataSourceId(field.id, column.field)" d="m4 10 4 4 8-9"/><g v-else><rect x="7" y="3" width="10" height="12" rx="2"/><path d="M13 17H5a2 2 0 0 1-2-2V7"/></g></svg>
              </button>
              <span v-if="!(field.detailColumns ?? field.arrayColumns ?? []).length" class="empty-copy">关联表没有可用字段</span>
              </div>
            </details>
            <button v-else class="data-source-row" type="button" :disabled="busy"
              :aria-label="`复制数据源 ${field.name}`"
              @click="copyDataSource({ id: fieldDataSourceId(field.id), label: field.name })">
              <span class="source-main"><span class="source-type-letter" aria-hidden="true">{{ /number|currency|percent|^2$|^9902$/i.test(field.type) ? "#" : /date|time|^5$|^1001$|^1002$/i.test(field.type) ? "▦" : "A" }}</span><span :title="field.name">{{ field.name }}</span></span>
              <svg class="source-copy-icon" viewBox="0 0 20 20" aria-hidden="true"><path v-if="copiedSourceId === fieldDataSourceId(field.id)" d="m4 10 4 4 8-9"/><g v-else><rect x="7" y="3" width="10" height="12" rx="2"/><path d="M13 17H5a2 2 0 0 1-2-2V7"/></g></svg>
            </button>
            </template>
            <span v-if="!fieldDataSources.length" class="empty-copy">当前表没有可用字段</span>
            <strong class="editor-group-title editor-group-system">系统</strong>
            <button class="data-source-row" type="button" aria-label="复制数据源 打印日期"
              @click="copyDataSource({ id: SYSTEM_PRINT_DATE_ID, label: '打印日期' })">
              <span class="source-main"><span class="source-type-letter" aria-hidden="true">◷</span><span>打印日期</span></span>
              <svg class="source-copy-icon" viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="3" width="10" height="12" rx="2"/><path d="M13 17H5a2 2 0 0 1-2-2V7"/></svg>
            </button>
            <span v-if="dataSourceSearch.trim() && !fieldDataSources.some(item => item.name.includes(dataSourceSearch.trim()) || (item.detailColumns ?? item.arrayColumns ?? []).some(column => column.header.includes(dataSourceSearch.trim())))" class="empty-copy">没有匹配的字段</span>
            <p class="source-panel-hint">点击字段复制，粘贴到编辑区域</p>
          </div>
          <div v-if="activeEditorPanel === 'components'" class="sidebar-section editor-content">
            <p class="component-hint">拖动组件到右侧画布；选中画布中的组件后，可在右侧属性面板进行设置。</p>
            <section v-for="group in DESIGNER_COMPONENT_GROUPS" :key="group.id" class="component-group">
              <strong class="editor-group-title">{{ group.label }}</strong>
              <button v-for="component in group.items" :key="component.type"
                class="data-source-row component-row" type="button" draggable="true"
                :aria-label="`拖动${component.label}组件到画布`"
                @dragstart="startComponentDrag(component.type, $event)">
                <span class="source-main">
                  <span class="source-symbol component-symbol" aria-hidden="true">{{ component.symbol }}</span>
                  <span class="component-copy"><span>{{ component.label }}</span><small>{{ component.description }}</small></span>
                </span>
                <small>拖入</small>
              </button>
            </section>
          </div>
        </template>
      </aside>

      <section class="workspace-main">
        <header v-if="presentation.showWorkspaceToolbar" class="workspace-toolbar">
          <div class="workspace-heading">
            <div class="workspace-title-line">
              <h2>{{ currentTemplateName }}</h2>
              <span v-if="workspaceMode === 'edit'" class="status-chip" :class="`status-${templateStatus}`">
                {{ templateStatusLabel }}
              </span>
            </div>
            <span v-if="workspaceMode === 'edit' && isBatchMode">
              {{ printJob?.table.name || "正在读取数据表" }} / 已选 {{ printJob?.documents.length ?? 0 }} 条 · 全部记录可滚动编辑 · 修改同步到全部记录
            </span>
            <span v-else>{{ printJob?.table.name || "正在读取数据表" }} / {{ currentRecordLabel }} ·
              {{ workspaceMode === 'edit'
                ? '模板编辑'
                : `${renderedLayoutLabel} · ${renderedOutputPageCount(renderedPages)} 页` }}</span>
          </div>
          <div class="workspace-actions">
            <div v-if="isBatchMode" class="batch-layout-switch" role="group" aria-label="批量排版">
              <span>批量排版</span>
              <button v-for="option in BATCH_LAYOUT_OPTIONS" :key="option.kind" type="button"
                class="batch-layout-button" :class="{ 'batch-layout-button-active': option.kind === currentBatchLayout }"
                :disabled="busy || option.kind === currentBatchLayout || !storedTemplate || selectedTemplateId === 'automatic'"
                :title="option.description" @click="changeBatchLayout(option.kind)">
                {{ option.label.replace('排版', '') }}
              </button>
            </div>
            <button v-if="presentation.showBack" class="button button-tertiary back-button"
              :disabled="busy" @click="requestPreviewMode">
              <span aria-hidden="true">←</span> 返回{{ isBatchMode ? "批量预览" : "预览" }}
            </button>
            <button v-if="presentation.showRecordPicker" class="button button-secondary button-record-picker"
              :disabled="busy || !templateLoaded" @click="requestLoadRecords(true)">
              {{ batchWorkspaceActions.selectLabel }}
            </button>
            <button v-if="presentation.showExitBatch" class="button button-tertiary" :disabled="busy"
              @click="requestExitBatch">退出批量</button>
            <button v-if="presentation.showOutputs" class="button button-secondary"
              :disabled="batchWorkspaceActions.outputDisabled" @click="exportPdf">
              {{ batchWorkspaceActions.exportPdfLabel }}
            </button>
            <button v-if="presentation.showOutputs" class="button button-primary"
              :disabled="batchWorkspaceActions.outputDisabled" @click="printOutput">
              {{ batchWorkspaceActions.printLabel }}
            </button>
            <button v-if="presentation.showEditTemplate" class="button button-secondary"
              :disabled="busy || !templateSelected || !templateSaveAllowed || (isBatchMode && !renderedPages)"
              @click="enterEditMode">编辑模板</button>
            <button v-if="presentation.showSave" class="button button-primary"
              :disabled="busy || !templateSaveAllowed" @click="saveTemplate()">保存模板</button>
          </div>
        </header>

        <div class="canvas-stage">
          <div class="designer-host" :class="{ 'designer-host-preview': !presentation.showDesigner }"
            :aria-hidden="!presentation.showDesigner ? 'true' : 'false'"
            :inert="!presentation.showDesigner ? true : undefined">
            <print-designer ref="designerRef" lang="zh" @ready="markDesignerReady" />
          </div>
          <section v-if="presentation.showPreview" ref="previewSurfaceRef" class="preview-surface" aria-label="打印预览">
            <div v-if="previewHtml" class="preview-paper-wrap">
              <div class="preview-paper-size" :style="previewPaperStyle">
                <iframe :srcdoc="previewHtml" :style="previewFrameStyle" title="打印预览"
                  class="preview-frame" scrolling="no" />
              </div>
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
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 0 12px;
  border-bottom: 1px solid var(--ui-divider);
  background: var(--ui-surface);
}
.brand-block { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.brand-mark { width: 22px; height: 22px; display: grid; place-items: center; flex: 0 0 22px; border-radius: 5px; background: var(--ui-primary); color: #fff; font-size: 11px; font-weight: 700; }
.brand-block h1 { margin: 0; font-size: 15px; line-height: 22px; font-weight: 600; white-space: nowrap; }
.workspace-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 6px; min-width: 0; }
.batch-layout-switch { display: inline-flex; align-items: center; gap: 2px; min-height: 30px; padding: 2px; border: 1px solid var(--ui-divider); border-radius: 6px; background: var(--ui-surface-subtle); }
.batch-layout-switch > span { padding: 0 6px; color: var(--ui-text-tertiary); font-size: 10px; white-space: nowrap; }
.batch-layout-button { min-height: 24px; border: 0; border-radius: 4px; padding: 0 7px; background: transparent; color: var(--ui-text-secondary); font: inherit; font-size: 11px; cursor: pointer; }
.batch-layout-button:hover:not(:disabled) { background: #fff; color: var(--ui-text); }
.batch-layout-button-active:disabled { background: #fff; color: var(--ui-primary); box-shadow: 0 0 0 1px var(--ui-divider); }
.batch-layout-button:disabled:not(.batch-layout-button-active) { cursor: not-allowed; color: var(--ui-text-disabled); }
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
.batch-layout-button:focus-visible,
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
  z-index: 60;
  left: 50%;
  top: 112px;
  max-width: min(620px, calc(100vw - 24px));
  min-height: 36px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border: 1px solid var(--ui-divider);
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 4px 12px rgba(31, 35, 41, .14);
  color: var(--ui-text);
  font-size: 14px;
  line-height: 20px;
  overflow-wrap: anywhere;
  transform: translateX(-50%);
}
.status-indicator { width: 18px; height: 18px; flex: 0 0 18px; color: #2ea121; }
.status-line-error .status-indicator { color: var(--ui-danger); }
.status-line-loading .status-indicator { color: var(--ui-primary); animation: status-spin .8s linear infinite; }
@keyframes status-spin { to { transform: rotate(360deg); } }
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
.workspace-edit { --workspace-sidebar-width: 190px; }
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
.template-create-error { display: grid; gap: 5px; margin-top: 7px; padding: 7px 8px; border-radius: 5px; background: #fff2f0; color: #8f2520; font-size: 11px; line-height: 16px; }
.template-create-error button { width: fit-content; border: 0; padding: 0; background: transparent; color: var(--ui-primary); font: inherit; font-weight: 500; cursor: pointer; }
.template-create-error button:disabled { color: var(--ui-text-disabled); cursor: not-allowed; }
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
.editor-tabs { flex: 0 0 44px; display: flex; gap: 10px; padding: 0 10px; border-bottom: 1px solid var(--ui-divider); background: #fff; }
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
.data-source-row.component-row { min-height: 42px; cursor: grab; }
.data-source-row.component-row:active { cursor: grabbing; }
.empty-copy, .component-hint { color: var(--ui-text-tertiary); font-size: 11px; }
.component-hint { margin: 0 0 10px; line-height: 17px; }
.component-group + .component-group { margin-top: 13px; }
.component-copy { min-width: 0; display: grid; gap: 1px; overflow: visible; white-space: normal; }
.component-copy > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.component-copy > small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status-chip { display: inline-flex; width: fit-content; align-items: center; border: 1px solid var(--ui-border); border-radius: 4px; padding: 1px 5px; color: var(--ui-text-secondary); font-size: 10px; white-space: nowrap; }
.status-saved { border-color: #c7e5cf; color: #28723d; }
.status-unsaved { border-color: #f1d4a6; color: #9a5f08; }
.status-fallback { border-color: #f2c4c1; color: #9a302a; }
.workspace-main { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.workspace-toolbar { flex: 0 0 auto; min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 12px 7px 16px; border-bottom: 1px solid var(--ui-divider); background: #fff; }
.workspace-heading { min-width: 0; display: grid; gap: 1px; }
.workspace-title-line { min-width: 0; display: flex; align-items: center; gap: 7px; }
.workspace-heading h2 { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 20px; font-weight: 600; }
.workspace-heading span { color: var(--ui-text-tertiary); font-size: 10px; line-height: 14px; }
.workspace-heading .status-saved { color: #28723d; }
.canvas-stage { position: relative; flex: 1; height: 100%; min-height: 0; overflow: hidden; background: var(--ui-workspace); }
.designer-host { position: absolute; z-index: 1; inset: 0; height: 100%; min-height: 0; overflow: hidden; background: #fff; opacity: 1; }
.designer-host-preview { opacity: 0; pointer-events: none; }
.designer-host print-designer { display: block; width: 100%; height: 100%; min-height: 0; }
.preview-surface { position: absolute; z-index: 2; inset: 0; overflow: auto; padding: 18px 16px 0; background: var(--ui-workspace); scrollbar-width: thin; }
.preview-paper-wrap { min-height: 100%; display: flex; justify-content: center; align-items: flex-start; }
.preview-paper-size { position: relative; flex: 0 0 auto; }
.preview-frame { position: absolute; top: 0; left: 0; display: block; overflow: hidden; border: 0; background: transparent; box-shadow: none; transform-origin: top left; }
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
  .workspace-edit { --workspace-sidebar-width: 156px; }
  .app-header { padding: 0 9px; }
  .workspace-toolbar { align-items: flex-start; padding: 6px 8px 6px 10px; }
  .workspace-heading { padding-top: 2px; }
  .workspace-actions { gap: 4px; }
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
  .workspace-toolbar { flex-wrap: wrap; }
  .workspace-actions .button { padding: 0 6px; font-size: 12px; }
  .workspace-toolbar { padding-right: 8px; padding-left: 10px; }
}
@media (prefers-reduced-motion: reduce) {
  .button { transition: none; }
  .status-line-loading .status-indicator { animation: none; }
}
/* Approved field-unit design: compact neutral fields and warm detail containers. */
.source-panel { padding: 14px 12px; }
.source-search { display: flex; align-items: center; gap: 8px; height: 34px; margin-bottom: 18px; padding: 0 10px; border: 1px solid #e9ecf0; border-radius: 5px; background: #f7f8fa; }
.source-search svg { width: 15px; height: 15px; fill: none; stroke: #9299a5; stroke-width: 1.5; flex-shrink: 0; }
.source-search input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; font: inherit; font-size: 12px; color: #20242b; }
.source-search:focus-within { border-color: #3370ff; }
.source-search input::placeholder { color: #9299a5; }
.source-section-heading { display: flex; justify-content: space-between; margin-bottom: 10px; }
.source-section-heading span { font-weight: 400; color: #a0a6b0; font-size: 10px; }
.source-panel .data-source-row { min-height: 38px; margin-bottom: 7px; padding: 0 11px; border: 1px solid #e7eaf0; border-radius: 5px; font-size: 12px; background: white; gap: 8px; }
.source-panel .data-source-row:hover:not(:disabled) { background: #f6f8fc; border-color: #cbd6ed; }
.source-panel .data-source-row:active:not(:disabled) { background: #e8f0ff; }
.source-type-letter { width: 16px; flex: 0 0 16px; color: #7a8290; font: 13px/16px Arial, sans-serif; }
.source-type-icon { width: 17px; height: 17px; flex: 0 0 17px; fill: none; stroke: currentColor; stroke-width: 1.3; }
.source-copy-icon { width: 15px; height: 15px; flex: 0 0 15px; fill: none; stroke: #9299a5; stroke-width: 1.25; }
.source-panel .data-source-row:hover .source-copy-icon { stroke: #3370ff; }
.detail-source-group { margin: 12px 0; border: 1px solid #ebdcc6; border-radius: 6px; background: #fffbf5; overflow: hidden; }
.source-panel .detail-source-summary { min-height: 42px; margin: 0; border: 0; border-radius: 0; background: transparent; color: #6b512f; cursor: pointer; list-style: none; gap: 5px; }
.detail-source-summary::-webkit-details-marker { display: none; }
.detail-source-summary .source-main { flex: 1; font-weight: 500; }
.source-link-icon { color: #a57b3d; }
.source-panel .detail-source-summary:hover { background: #faf2e7; }
.source-panel .detail-source-count { font-size: 10px; color: #a18a69; }
.source-chevron { width: 12px; height: 12px; flex: 0 0 12px; fill: none; stroke: #aa8b5a; stroke-width: 1.4; }
.detail-source-group[open] .source-chevron { transform: rotate(90deg); }
.detail-source-fields { padding: 0 8px 3px; }
.source-panel .detail-source-child { min-height: 54px; padding: 8px 10px; border-color: #e8dfd1; align-items: center; }
.detail-field-copy { min-width: 0; display: grid; gap: 6px; }
.detail-field-copy .source-type-letter { color: #998265; }
.source-placeholder { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: #a28a68; font-size: 10px; line-height: 14px; }
.detail-source-child .source-copy-icon { align-self: flex-end; stroke: #b2915e; margin-bottom: 2px; }
.source-panel-hint { margin: 16px 0 0; color: #9299a5; font-size: 10px; line-height: 16px; }
.source-panel .data-source-row:focus-visible { outline: 2px solid #3370ff; outline-offset: 1px; }
.source-panel .data-source-row:disabled { color: #a7adb6; background: #f7f8fa; cursor: not-allowed; }
</style>
