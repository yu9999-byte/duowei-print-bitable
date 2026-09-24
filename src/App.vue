<script setup lang="ts">
import { bitable } from "@lark-base-open/js-sdk";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import {
  bindPrintJob,
  exportPrintJob,
  getPrintPreviewHtml,
  installDesignerPrintInterception,
  installDesignerTemplatePanelSuppression,
  installDataSourceTerminology,
  previewPrintJob,
  printPrintJob,
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
import {
  buildDataSourceDragPayload,
  DESIGNER_DATA_VARIABLE_DRAG_MIME,
  DESIGNER_VARIABLE_DRAG_MIME,
  SYSTEM_PRINT_DATE_ID,
} from "./core/data-sources.ts";
import { loadTemplateForUse } from "./core/template-repository.ts";
import {
  canEnterTemplateEdit,
  EDITOR_PANELS,
  getTemplateStatus,
  initialWorkspaceMode,
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
const storedTemplate = ref<{ checksum: string; updatedAt: string; template: unknown } | null>(null);
const templateFallback = ref(false);
const templateLoaded = ref(false);
const templateSaveAllowed = ref(false);
const templateDirty = ref(false);
const selectedTemplateId = ref<string | null>(null);
const decisionDialog = ref<"leave" | "reload" | "context" | null>(null);
const pendingContext = ref<FeishuSelection | null>(null);
const pendingLoadRequest = ref<"current" | "batch" | null>(null);
const workspaceMode = ref<WorkspaceMode>(initialWorkspaceMode());
const activeEditorPanel = ref<EditorPanel>("components");
const previewHtml = ref("");
const designerReady = ref(false);
const batchPreviewUrl = ref("");
const status = ref("正在读取当前记录…");
const error = ref("");
const busy = ref(false);
let contextRevision = 0;
let stopSelectionWatch: (() => void) | undefined;
let stopDataSourceTerminology: (() => void) | undefined;
let stopDesignerPrintInterception: (() => void) | undefined;
let stopDesignerTemplatePanelSuppression: (() => void) | undefined;
let stopDesignerDirtyTracking: (() => void) | undefined;
let resolveDesignerReady: (() => void) | undefined;
const readyPromise = new Promise<void>((resolve) => { resolveDesignerReady = resolve; });

const editorPanelLabels: Record<EditorPanel, string> = {
  "data-sources": "数据源",
  components: "组件",
  "page-settings": "页面设置",
  settings: "设置",
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
const currentTemplateName = computed(() => printJob.value?.table.name
  ? `${printJob.value.table.name} · 打印单`
  : "本表模板");
const currentTemplateId = computed(() => selection.value
  ? `active:${selection.value.baseId}:${selection.value.tableId}`
  : null);
const templateSelected = computed(() => Boolean(
  currentTemplateId.value && selectedTemplateId.value === currentTemplateId.value,
));
const fieldDataSources = computed(() => printJob.value?.table.fields ?? []);
const currentRecordLabel = computed(() => {
  const count = printJob.value?.documents.length ?? 0;
  return count === 1 ? "当前记录" : `${count} 条记录`;
});

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
  templateFallback.value = false;
  templateLoaded.value = false;
  templateSaveAllowed.value = false;
  templateDirty.value = false;
  selectedTemplateId.value = null;
  decisionDialog.value = null;
  pendingContext.value = null;
  pendingLoadRequest.value = null;
  previewHtml.value = "";
  workspaceMode.value = initialWorkspaceMode();
  closeBatchPreview();
  status.value = "当前记录已切换，请重新读取";
}

async function assertCurrentContext(expected: FeishuSelection, revision: number) {
  if (revision !== contextRevision || !sameContext(expected, await getActiveSelection())) {
    throw new Error("当前记录、数据表或视图已切换，请重新读取");
  }
}

async function loadRecords(useBatchPicker = false) {
  const revision = ++contextRevision;
  busy.value = true;
  error.value = "";
  selection.value = null;
  printJob.value = null;
  templateChecksum.value = null;
  storedTemplate.value = null;
  templateFallback.value = false;
  templateLoaded.value = false;
  templateSaveAllowed.value = false;
  templateDirty.value = false;
  selectedTemplateId.value = null;
  decisionDialog.value = null;
  pendingContext.value = null;
  pendingLoadRequest.value = null;
  previewHtml.value = "";
  workspaceMode.value = initialWorkspaceMode();
  closeBatchPreview();
  try {
    const active = await getActiveSelection();
    selection.value = active;
    const ids = useBatchPicker
      ? await selectRecordIds(active)
      : getCurrentRecordIds(active);
    await assertCurrentContext(active, revision);
    if (!ids.length) {
      status.value = useBatchPicker
        ? "请在批量选择器中选择至少一条记录"
        : "当前不是有效的记录视图，请从多维表格记录详情打开多维打印";
      printJob.value = null;
      return;
    }
    const job = await loadPrintJob(active, ids);
    await assertCurrentContext(active, revision);
    printJob.value = job;
    status.value = "已加载 " + printJob.value.documents.length + " 条记录";
    await nextTick();
    await waitForDesignerReady();
    await assertCurrentContext(active, revision);
    await loadTemplateAndPreview(job, active, revision);
  } catch (cause) {
    if (revision === contextRevision) {
      error.value = cause instanceof Error ? cause.message : "读取飞书数据失败";
      status.value = "加载失败";
    }
  } finally {
    busy.value = false;
  }
}

async function loadTemplateAndPreview(
  job = printJob.value,
  active = selection.value,
  revision = contextRevision,
) {
  if (!designerRef.value || !job || !active) return;
  busy.value = true;
  error.value = "";
  try {
    const templateLoad = await loadTemplateForUse(templateRepository, {
      baseId: active.baseId,
      tableId: active.tableId,
    });
    const stored = templateLoad.stored;
    await assertCurrentContext(active, revision);
    await bindPrintJob(designerRef.value, stored?.template ?? null, job);
    await assertCurrentContext(active, revision);
    storedTemplate.value = stored;
    templateFallback.value = Boolean(templateLoad.warning);
    templateChecksum.value = stored?.checksum ?? null;
    templateLoaded.value = true;
    templateSaveAllowed.value = templateLoad.canSave;
    templateDirty.value = false;
    captureTemplateBaseline();
    previewHtml.value = job.documents.length === 1
      ? await getPrintPreviewHtml(designerRef.value, job)
      : "";
    if (templateLoad.warning) {
      error.value = `${templateLoad.warning}；原模板未覆盖，已改用自动模板并绑定真实数据`;
      status.value = "已加载当前记录和动态数据源；旧模板暂不可保存";
    } else {
      status.value = stored
        ? "已加载本表活动模板并绑定真实数据"
        : "本表尚无活动模板，已自动生成并绑定真实数据";
    }
  } catch (cause) {
    if (revision === contextRevision) {
      error.value = cause instanceof Error ? cause.message : "打印模板加载失败";
      status.value = "模板加载失败";
    }
  } finally {
    busy.value = false;
  }
}

let templateBaseline = "";

function readTemplateSnapshot() {
  if (!designerRef.value) return "";
  try {
    return JSON.stringify(designerRef.value.getTemplateData());
  } catch {
    return "";
  }
}

function captureTemplateBaseline() {
  templateBaseline = readTemplateSnapshot();
}

function refreshTemplateDirtyState() {
  if (workspaceMode.value !== "edit" || !templateBaseline) return;
  const snapshot = readTemplateSnapshot();
  if (snapshot) templateDirty.value = snapshot !== templateBaseline;
}

function installDesignerDirtyTracking() {
  const designer = designerRef.value;
  if (!designer) return () => undefined;
  const events = ["input", "change", "pointerup", "keyup"];
  const handleInteraction = () => queueMicrotask(refreshTemplateDirtyState);
  events.forEach((eventName) => designer.addEventListener(eventName, handleInteraction));
  return () => events.forEach((eventName) => designer.removeEventListener(eventName, handleInteraction));
}

async function refreshPreview() {
  if (!designerRef.value || !printJob.value || printJob.value.documents.length !== 1) return;
  const active = selection.value;
  const revision = contextRevision;
  busy.value = true;
  error.value = "";
  try {
    previewHtml.value = await getPrintPreviewHtml(designerRef.value, printJob.value);
    if (active) await assertCurrentContext(active, revision);
    status.value = "打印预览已刷新";
  } catch (cause) {
    if (revision === contextRevision) {
      error.value = cause instanceof Error ? cause.message : "打印预览生成失败";
      status.value = "预览失败";
    }
  } finally {
    busy.value = false;
  }
}

function markDesignerReady() {
  designerReady.value = true;
  stopDataSourceTerminology?.();
  stopDesignerTemplatePanelSuppression?.();
  if (designerRef.value) {
    stopDataSourceTerminology = installDataSourceTerminology(designerRef.value);
    stopDesignerTemplatePanelSuppression = installDesignerTemplatePanelSuppression(window);
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

function closeBatchPreview() {
  if (batchPreviewUrl.value) URL.revokeObjectURL(batchPreviewUrl.value);
  batchPreviewUrl.value = "";
}

async function previewOutput() {
  if (!designerRef.value || !printJob.value || !templateLoaded.value || !selection.value) return;
  if (printJob.value.documents.length === 1) {
    await refreshPreview();
    return;
  }
  const active = selection.value;
  const revision = contextRevision;
  busy.value = true;
  error.value = "";
  try {
    closeBatchPreview();
    const preview = await previewPrintJob(designerRef.value, printJob.value);
    await assertCurrentContext(active, revision);
    if (preview.kind === "pdf") {
      batchPreviewUrl.value = URL.createObjectURL(preview.blob);
      status.value = `已生成 ${printJob.value.documents.length} 条记录的一体化 PDF 预览`;
    } else {
      status.value = "已打开单条打印预览";
    }
  } catch (cause) {
    if (revision === contextRevision) {
      error.value = cause instanceof Error ? cause.message : "打印预览失败";
      status.value = "预览失败";
    }
  } finally {
    busy.value = false;
  }
}

async function saveTemplate(options: { returnToPreview?: boolean; allowContextChange?: boolean } = {}): Promise<boolean> {
  if (!designerRef.value || !selection.value || !templateSaveAllowed.value) return false;
  const active = selection.value;
  const revision = contextRevision;
  busy.value = true;
  error.value = "";
  try {
    if (!options.allowContextChange) await assertCurrentContext(active, revision);
    const saved = await templateRepository.save(
      { baseId: active.baseId, tableId: active.tableId },
      designerRef.value.getTemplateData(),
      { expectedChecksum: templateChecksum.value },
    );
    if (!options.allowContextChange) await assertCurrentContext(active, revision);
    templateChecksum.value = saved.checksum;
    storedTemplate.value = saved;
    templateFallback.value = false;
    templateDirty.value = false;
    captureTemplateBaseline();
    if (!options.allowContextChange) {
      previewHtml.value = printJob.value?.documents.length === 1
        ? await getPrintPreviewHtml(designerRef.value, printJob.value)
        : "";
    }
    status.value = "本表活动模板已保存（未写入当前记录值）";
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

async function createTemplate() {
  if (!designerRef.value || !printJob.value || !templateLoaded.value) return;
  if (!templateSelected.value) {
    status.value = "请先选择本表活动模板，再创建新的编辑草稿";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    await bindPrintJob(designerRef.value, null, printJob.value);
    templateDirty.value = true;
    workspaceMode.value = "edit";
    activeEditorPanel.value = "components";
    if (printJob.value.documents.length === 1) {
      previewHtml.value = await getPrintPreviewHtml(designerRef.value, printJob.value);
    }
    status.value = "已创建未保存模板草稿";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "新模板创建失败";
    status.value = "新模板创建失败";
  } finally {
    busy.value = false;
  }
}

function selectTemplate() {
  if (!templateLoaded.value || !currentTemplateId.value) return;
  selectedTemplateId.value = currentTemplateId.value;
  status.value = "已选中本表活动模板，可进入编辑";
}

function enterEditMode() {
  if (!canEnterTemplateEdit({
    templateLoaded: templateLoaded.value,
    templateSelected: templateSelected.value,
  })) {
    status.value = "请先在模板目录中选择模板";
    return;
  }
  workspaceMode.value = "edit";
  activeEditorPanel.value = "components";
  status.value = "已进入编辑模式";
}

async function applyPreviewMode() {
  if (workspaceMode.value === "edit") workspaceMode.value = toggleWorkspaceMode(workspaceMode.value);
  await refreshPreview();
}

function requestPreviewMode() {
  if (workspaceMode.value !== "edit") {
    void refreshPreview();
    return;
  }
  if (shouldGuardUnsavedNavigation(templateDirty.value)) {
    decisionDialog.value = "leave";
    return;
  }
  void applyPreviewMode();
}

function requestTemplateReload() {
  if (shouldGuardUnsavedNavigation(templateDirty.value)) {
    decisionDialog.value = "reload";
    return;
  }
  void loadTemplateAndPreview();
}

function requestLoadRecords(useBatchPicker = false) {
  if (shouldGuardUnsavedNavigation(templateDirty.value)) {
    pendingContext.value = null;
    pendingLoadRequest.value = useBatchPicker ? "batch" : "current";
    decisionDialog.value = "context";
    return;
  }
  void loadRecords(useBatchPicker);
}

async function resolveDecision(decision: "save" | "discard" | "cancel") {
  const action = decisionDialog.value;
  decisionDialog.value = null;
  if (!action || decision === "cancel") {
    if (decision === "cancel") {
      if (action === "context") {
        status.value = "已保留当前模板草稿；宿主记录已切换，完成编辑后请重新读取";
      }
      pendingContext.value = null;
      pendingLoadRequest.value = null;
    }
    return;
  }
  if (action === "context") {
    if (decision === "save") {
      const saved = await saveTemplate({ allowContextChange: true });
      if (!saved) return;
    }
    const useBatchPicker = pendingLoadRequest.value === "batch";
    pendingContext.value = null;
    pendingLoadRequest.value = null;
    invalidateContext();
    void loadRecords(useBatchPicker);
    return;
  }
  if (decision === "save") {
    const saved = await saveTemplate();
    if (!saved) return;
  } else {
    await loadTemplateAndPreview();
  }
  if (action === "leave") await applyPreviewMode();
  else if (action === "reload" && decision === "save") await loadTemplateAndPreview();
}

function selectEditorPanel(panel: EditorPanel) {
  activeEditorPanel.value = panel;
}

function startDataSourceDrag(source: { id: string; label: string; isArray?: boolean }, event: DragEvent) {
  const payload = buildDataSourceDragPayload(source);
  const variable = payload.type === "table" ? payload.dataVariable : payload.variable;
  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("application/json", JSON.stringify(payload));
  event.dataTransfer.setData(
    payload.type === "table" ? DESIGNER_DATA_VARIABLE_DRAG_MIME : DESIGNER_VARIABLE_DRAG_MIME,
    variable,
  );
  event.dataTransfer.setData("text/plain", variable);
}

async function printOutput() {
  if (!designerRef.value || !printJob.value || !selection.value) return;
  const active = selection.value;
  const revision = contextRevision;
  busy.value = true;
  error.value = "";
  try {
    await assertCurrentContext(active, revision);
    await printPrintJob(designerRef.value, printJob.value);
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
    await assertCurrentContext(active, revision);
    await exportPrintJob(designerRef.value, printJob.value, "duowei-print.pdf");
    await assertCurrentContext(active, revision);
    status.value = "已发起 PDF 导出，请核对下载文件内容";
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
  if (designerRef.value?.isReady) markDesignerReady();
  stopSelectionWatch = bitable.base.onSelectionChange(({ data }) => {
    if (!selection.value || sameContext(selection.value, data)) return;
    if (shouldGuardUnsavedNavigation(templateDirty.value)) {
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
  stopDesignerDirtyTracking?.();
  stopDesignerPrintInterception?.();
  stopDesignerTemplatePanelSuppression?.();
  closeBatchPreview();
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
        <button class="button button-quiet" :disabled="busy" @click="requestLoadRecords(false)">
          {{ busy ? "读取中…" : "重新读取" }}
        </button>
        <button class="button button-quiet" :disabled="busy" @click="requestLoadRecords(true)">批量选择</button>
        <button :disabled="busy || !templateLoaded" class="button button-outline" @click="printOutput">打印</button>
        <button :disabled="busy || !templateLoaded" class="button button-outline" @click="exportPdf">导出 PDF</button>
      </div>
    </header>

    <div class="status-line" :class="{ 'status-line-error': error }">
      <span class="status-dot" aria-hidden="true"></span>
      <span>{{ error || status }}</span>
    </div>

    <section class="workspace" :class="`workspace-${workspaceMode}`">
      <aside class="sidebar" aria-label="模板和编辑入口">
        <div class="sidebar-section template-section">
          <div class="sidebar-title-row">
            <span class="sidebar-title">模板目录</span>
            <span class="sidebar-count">本表</span>
          </div>
          <button
            class="template-item"
            :class="{ 'template-item-active': templateSelected }"
            :disabled="!templateLoaded"
            @click="selectTemplate"
          >
            <span class="template-item-mark" aria-hidden="true"></span>
            <span class="template-item-copy">
              <strong>{{ currentTemplateName }}</strong>
              <small>{{ templateStatusLabel }}</small>
            </span>
          </button>
          <button
            class="button button-edit-template"
            :disabled="busy || !templateSelected"
            @click="enterEditMode"
          >
            编辑模板
          </button>
          <button
            class="button button-new-template"
            :disabled="busy || !templateSelected"
            @click="createTemplate"
          >
            <span aria-hidden="true">＋</span>
            新建模板
          </button>
          <p class="sidebar-note">当前 MVP 每张表保留一个活动模板。</p>
        </div>

        <nav v-if="workspaceMode === 'edit'" class="sidebar-section editor-nav" aria-label="编辑入口">
          <div class="sidebar-title-row">
            <span class="sidebar-title">编辑入口</span>
            <span class="sidebar-count">4</span>
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

        <div class="sidebar-footer">
          <span class="status-chip" :class="`status-${templateStatus}`">{{ templateStatusLabel }}</span>
          <button
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
            <p class="workspace-kicker">{{ workspaceMode === 'preview' ? '打印预览' : '模板编辑' }}</p>
            <h2>{{ currentTemplateName }}</h2>
          </div>
          <div class="workspace-actions">
            <template v-if="workspaceMode === 'edit'">
              <span class="save-state">{{ templateStatusLabel }}</span>
              <button class="button button-quiet" :disabled="busy" @click="requestPreviewMode">
                返回预览
              </button>
              <button
                class="button button-primary"
                :disabled="busy || !templateSaveAllowed"
                :title="!templateSaveAllowed ? '当前模板处于只读回退状态，暂不可覆盖保存' : ''"
                @click="saveTemplate()"
              >
                保存模板
              </button>
            </template>
            <button v-else class="button button-quiet" :disabled="busy || !templateLoaded" @click="previewOutput">
              刷新预览
            </button>
          </div>
        </header>

        <section v-if="workspaceMode === 'edit'" class="editor-context">
          <div v-if="activeEditorPanel === 'data-sources'" class="context-panel">
            <div class="context-panel-heading">
              <div>
                <p class="context-kicker">数据源</p>
                <h3>字段和系统值</h3>
              </div>
              <span>{{ fieldDataSources.length }} 个字段</span>
            </div>
            <div class="data-source-groups">
              <div class="data-source-group">
                <strong>字段</strong>
                <button
                  v-for="field in fieldDataSources"
                  :key="field.id"
                  class="data-source-row"
                  draggable="true"
                  type="button"
                  @dragstart="startDataSourceDrag({
                    id: field.name,
                    label: field.name,
                    isArray: Boolean(field.isLink || field.arrayColumns),
                  }, $event)"
                >
                  <span>{{ field.name }}</span>
                  <small>{{ field.isLink || field.arrayColumns ? '数组' : '字段' }}</small>
                </button>
                <span v-if="!fieldDataSources.length" class="empty-copy">当前表没有可用字段</span>
              </div>
              <div class="data-source-group">
                <strong>系统</strong>
                <button
                  class="data-source-row"
                  draggable="true"
                  type="button"
                  @dragstart="startDataSourceDrag({ id: SYSTEM_PRINT_DATE_ID, label: '打印日期' }, $event)"
                >
                  <span>打印日期</span><small>系统</small>
                </button>
              </div>
            </div>
            <p class="context-hint">拖入画布即可创建已绑定的文本或表格组件。</p>
          </div>

          <div v-else-if="activeEditorPanel === 'components'" class="context-panel context-panel-compact">
            <div>
              <p class="context-kicker">组件</p>
              <h3>在设计器画布中编辑模板</h3>
            </div>
            <p class="context-hint">静态组件由 vue-print-designer 提供，动态字段统一从“数据源”进入。</p>
          </div>

          <div v-else-if="activeEditorPanel === 'page-settings'" class="context-panel">
            <div class="context-panel-heading">
              <div>
                <p class="context-kicker">页面设置</p>
                <h3>当前模板页面</h3>
              </div>
              <span>只读摘要</span>
            </div>
            <div class="settings-grid">
              <div><span>纸张</span><strong>A4</strong></div>
              <div><span>方向</span><strong>纵向</strong></div>
              <div><span>页数</span><strong>由设计器渲染</strong></div>
            </div>
            <p class="context-hint">完整纸型和分页控制仍由 vue-print-designer 负责，本切片不改变分页策略。</p>
          </div>

          <div v-else class="context-panel">
            <div class="context-panel-heading">
              <div>
                <p class="context-kicker">设置</p>
                <h3>模板信息</h3>
              </div>
              <span>{{ templateSaveAllowed ? '可保存' : '只读' }}</span>
            </div>
            <div class="settings-grid">
              <div><span>模板</span><strong>{{ currentTemplateName }}</strong></div>
              <div><span>状态</span><strong>{{ templateStatusLabel }}</strong></div>
              <div><span>数据表</span><strong>{{ printJob?.table.name || '未读取' }}</strong></div>
            </div>
            <p class="context-hint">模板只保存布局，不保存当前记录值。</p>
          </div>
        </section>

        <div class="canvas-stage">
          <div class="designer-host" :class="{ 'designer-host-preview': workspaceMode === 'preview' }">
            <print-designer ref="designerRef" lang="zh" @ready="markDesignerReady" />
          </div>
          <section v-if="workspaceMode === 'preview'" class="preview-surface" aria-label="打印预览">
            <div v-if="previewHtml" class="preview-paper-wrap">
              <iframe :srcdoc="previewHtml" title="打印预览" class="preview-frame" />
            </div>
            <div v-else class="preview-empty">
              <strong>正在生成打印预览</strong>
              <span>读取真实多维表格数据后，预览会显示在这里。</span>
            </div>
          </section>
        </div>
      </section>
    </section>

    <section v-if="batchPreviewUrl" class="preview-overlay" role="dialog" aria-modal="true" aria-label="批量 PDF 预览">
      <div class="preview-card">
        <header class="preview-header">
          <strong>批量 PDF 预览</strong>
          <button @click="closeBatchPreview">关闭</button>
        </header>
        <iframe :src="batchPreviewUrl" title="批量 PDF 预览" />
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
.status-line-error { color: #a33a32; }
.status-dot { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: #5b8c68; }
.status-line-error .status-dot { background: #b44d45; }
.workspace { display: grid; grid-template-columns: 220px minmax(0, 1fr); min-height: calc(100dvh - 130px); overflow: hidden; border: 1px solid #dfe4ea; background: #fbfcfd; }
.sidebar { display: flex; flex-direction: column; border-right: 1px solid #dfe4ea; background: #f6f8fa; }
.sidebar-section { padding: 18px 14px; }
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
.data-source-row { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; border: 0; border-bottom: 1px solid #e5e9ee; padding: 6px 0; background: transparent; color: #334457; font: inherit; font-size: 12px; text-align: left; cursor: grab; }
.data-source-row:hover { border-bottom-color: #9fb2c5; color: #244c74; }
.data-source-row:active { cursor: grabbing; }
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
.preview-overlay { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; padding: 24px; background: rgb(15 23 42 / 55%); }
.preview-card { display: grid; grid-template-rows: auto 1fr; width: min(1100px, 96vw); height: 92vh; overflow: hidden; border: 1px solid #cbd3dc; background: #fff; }
.preview-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid #d8dee4; }
.preview-card iframe { width: 100%; height: 100%; border: 0; }
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
  .preview-overlay { padding: 8px; }
  .preview-card { width: 100%; height: 96vh; }
}
</style>
