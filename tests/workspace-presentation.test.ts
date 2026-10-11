import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getWorkspacePresentation,
  getWorkspaceSidebarLayout,
} from "../src/components/workspace-presentation.ts";

test("CT-UX-09: single preview owns templates, edit entry, record selection, and outputs", () => {
  assert.deepEqual(getWorkspacePresentation("single-preview"), {
    showBrand: true,
    showTemplateDirectory: true,
    showEditorPanel: false,
    showInlineEditorPanel: false,
    showBatchSummary: false,
    showWorkspaceToolbar: true,
    showRecordPicker: true,
    showExitBatch: false,
    showOutputs: true,
    showEditTemplate: true,
    showSave: false,
    showBack: false,
    showDesigner: false,
    showPreview: true,
  });
});

test("CT-UX-09: single edit hides template and output actions", () => {
  assert.deepEqual(getWorkspacePresentation("single-edit"), {
    showBrand: true,
    showTemplateDirectory: false,
    showEditorPanel: true,
    showInlineEditorPanel: false,
    showBatchSummary: false,
    showWorkspaceToolbar: true,
    showRecordPicker: false,
    showExitBatch: false,
    showOutputs: false,
    showEditTemplate: false,
    showSave: true,
    showBack: true,
    showDesigner: true,
    showPreview: false,
  });
});

test("CT-UX-09: batch preview uses the template directory and exposes the current template edit entry", () => {
  assert.deepEqual(getWorkspacePresentation("batch-preview"), {
    showBrand: true,
    showTemplateDirectory: true,
    showEditorPanel: false,
    showInlineEditorPanel: false,
    showBatchSummary: false,
    showWorkspaceToolbar: true,
    showRecordPicker: true,
    showExitBatch: true,
    showOutputs: true,
    showEditTemplate: true,
    showSave: false,
    showBack: false,
    showDesigner: false,
    showPreview: true,
  });
});

test("CT-UX-09: batch edit hides the template directory and gives the single editor panel the sidebar", () => {
  assert.deepEqual(getWorkspacePresentation("batch-edit"), {
    showBrand: true,
    showTemplateDirectory: false,
    showEditorPanel: true,
    showInlineEditorPanel: false,
    showBatchSummary: false,
    showWorkspaceToolbar: true,
    showRecordPicker: false,
    showExitBatch: false,
    showOutputs: false,
    showEditTemplate: false,
    showSave: true,
    showBack: true,
    showDesigner: true,
    showPreview: false,
  });
});

test("CT-UX-10: canvas-first sidebar stays compact without shrinking the editor panel", () => {
  assert.deepEqual(getWorkspaceSidebarLayout("single-preview", 932), { width: 188, compact: false });
  assert.deepEqual(getWorkspaceSidebarLayout("batch-preview", 932), { width: 188, compact: false });
  assert.deepEqual(getWorkspaceSidebarLayout("batch-edit", 932), { width: 190, compact: false });
  assert.deepEqual(getWorkspaceSidebarLayout("single-edit", 932), { width: 190, compact: false });
  assert.deepEqual(getWorkspaceSidebarLayout("single-preview", 700), { width: 164, compact: true });
  assert.deepEqual(getWorkspaceSidebarLayout("batch-preview", 700), { width: 164, compact: true });
  assert.deepEqual(getWorkspaceSidebarLayout("batch-edit", 700), { width: 156, compact: true });
  assert.deepEqual(getWorkspaceSidebarLayout("single-edit", 700), { width: 156, compact: true });
});

test("CT-UX-09: App exposes one edit action and one save action per active surface", () => {
  const source = readFileSync("src/App.vue", "utf8");
  const editActions = source.match(/>编辑模板<\/button>/g) ?? [];
  const saveActions = source.match(/@click="saveTemplate\(\)">保存模板<\/button>/g) ?? [];
  const backActions = source.match(/返回\{\{ isBatchMode \? "批量预览" : "预览" \}\}/g) ?? [];

  assert.equal(editActions.length, 1);
  assert.equal(saveActions.length, 1, "both edit surfaces share the same mutually exclusive workspace toolbar");
  assert.equal(backActions.length, 1);
  const appHeader = source.match(/<header class="app-header">[\s\S]*?<\/header>/)?.[0] ?? "";
  assert.match(appHeader, /多维打印/);
  assert.doesNotMatch(appHeader, /requestLoadRecords\(true\)/);
  assert.match(source, /class="workspace-actions"[\s\S]*?presentation\.showBack[\s\S]*?保存模板<\/button>[\s\S]*?<\/div>/);
});

test("CT-UX-05/09: template switching remains behind the unsaved-draft guard", () => {
  const source = readFileSync("src/App.vue", "utf8");
  const guardedSelection = source.match(/function requestTemplateSelection\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(guardedSelection, /shouldGuardUnsavedNavigation\(refreshTemplateDirtyState\(\)\)/);
  assert.match(guardedSelection, /pendingPreviewTemplateId\.value = id/);
  assert.match(source, /@click="requestTemplateSelection\('automatic'\)"/);
  assert.match(source, /@click="requestTemplateSelection\(item\.id\)"/);
});

test("SPEC-BATCH-08: switching or creating templates cannot carry another template's batch", () => {
  const source = readFileSync("src/App.vue", "utf8");
  const switchFlow = source.slice(
    source.indexOf("async function selectTemplate"),
    source.indexOf("async function updateDirectory"),
  );
  const createFlow = source.slice(
    source.indexOf("async function createTemplate"),
    source.indexOf("async function changeBatchLayout"),
  );
  for (const flow of [switchFlow, createFlow]) {
    assert.match(flow, /shouldExitBatchOnTemplateSwitch/);
    assert.match(flow, /loadPrintJob\(active, currentIds\)/);
    assert.match(flow, /createSinglePrintSession\(active\.recordId\)/);
  }
});

test("CT-UX-08/09: App shell removes the old duplicated and native-looking controls", () => {
  const source = readFileSync("src/App.vue", "utf8");
  assert.doesNotMatch(source, /class="eyebrow"/);
  assert.doesNotMatch(source, /class="template-item-actions"/);
  assert.doesNotMatch(source, />刷新预览</);
  assert.doesNotMatch(source, />重新读取</);
  assert.doesNotMatch(source, /editor-nav-index/);
  assert.match(source, /aria-haspopup="menu"/);
  assert.match(source, /role="menu"/);
  assert.match(source, /class="button button-primary"[^>]*@click="printOutput"/);
  assert.match(source, /scrolling="no"/);
  assert.match(source, /setTheme\?\.\("light"\)/);
  assert.match(source, /visibleTemplateCount/);
  assert.match(source, /\{\{ visibleTemplateCount \}\} 个/);
});

test("CT-UX-11: template rename and delete use the product dialog instead of browser prompts", () => {
  const source = readFileSync("src/App.vue", "utf8");
  assert.doesNotMatch(source, /window\.prompt/);
  assert.doesNotMatch(source, /window\.confirm/);
  assert.match(source, /templateManagementDialog/);
  assert.match(source, /aria-labelledby="template-management-title"/);
  assert.match(source, /aria-describedby="template-management-description"/);
  assert.match(source, /aria-label="模板名称"/);
  assert.match(source, /@keydown\.tab="trapTemplateManagementFocus"/);
  assert.match(source, /templateManagementReturnFocus/);
  assert.match(source, />确认删除</);
});

test("CT-UX-08/10: the visual shell declares Feishu tokens and one scroll owner", () => {
  const source = readFileSync("src/App.vue", "utf8");
  assert.match(source, /--ui-primary:\s*#3370ff/i);
  assert.match(source, /--ui-workspace:\s*#f2f3f5/i);
  assert.match(source, /\.app-shell\s*\{[^}]*height:\s*100dvh/s);
  assert.match(source, /\.preview-surface\s*\{[^}]*overflow:\s*auto/s);
  assert.match(source, /\.preview-frame\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(source, /@media\s*\(max-width:\s*760px\)/);
});

test("CT-UX-12: the real designer receives a complete height chain and keeps internal scroll ownership", () => {
  const source = readFileSync("src/App.vue", "utf8");
  assert.match(source, /\.canvas-stage\s*\{[^}]*height:\s*100%[^}]*overflow:\s*hidden/s);
  assert.match(source, /\.designer-host\s*\{[^}]*height:\s*100%[^}]*overflow:\s*hidden/s);
  assert.match(source, /\.designer-host print-designer\s*\{[^}]*height:\s*100%[^}]*min-height:\s*0/s);
  assert.doesNotMatch(source, /\.designer-host\s*\{[^}]*overflow:\s*(?:auto|scroll)/s);
});

test("CT-BATCH-09-EDIT: App replaces the example switcher with one full-batch editable projection", () => {
  const source = readFileSync("src/App.vue", "utf8");
  assert.match(source, /bindBatchEditProjection/);
  assert.match(source, /synchronizeBatchEditProjection/);
  assert.match(source, /已选.*条.*全部记录.*编辑/);
  assert.doesNotMatch(source, /batchEditExample/);
  assert.doesNotMatch(source, /示例记录/);
  assert.doesNotMatch(source, /上一条示例记录|下一条示例记录/);
  assert.doesNotMatch(source, /recordTemplate|记录级模板/);
  assert.match(source, /async function enterEditMode\([\s\S]*?bindBatchEditProjection/);
  assert.match(source, /async function createTemplate\([\s\S]*?bindBatchEditProjection/);
  assert.match(source, /if \(batchEditing\) await flushBatchProjectionSync\(\)/);
});

test("SPEC-UX-13/14/CT-TPL-06: components remain editable while batch layouts stop creating templates", () => {
  const source = readFileSync("src/App.vue", "utf8");
  assert.match(source, /components:\s*"组件"/);
  assert.match(source, /选中画布中的组件后，可在右侧属性面板/);
  assert.match(source, /TEMPLATE_CREATION_OPTIONS/);
  assert.match(source, /createTemplate\(option\.kind\)/);
  assert.doesNotMatch(source, />默认模板<\/strong><small>每条记录从新页开始/);
  assert.doesNotMatch(source, />连续模板</);
  assert.doesNotMatch(source, />标签模板</);
  assert.doesNotMatch(source, /新建为其他排版/);
  assert.doesNotMatch(source, /createLayoutDraft/);
  assert.match(source, /changeBatchLayout/);
  assert.match(source, /BATCH_LAYOUT_OPTIONS/);
});

test("CT-BATCH-11-UI: retry replays the failed request without reopening the record picker", () => {
  const source = readFileSync("src/App.vue", "utf8");
  assert.match(source, /async function retryBatchCandidate/);
  assert.match(source, /@click="retryBatchCandidate">重试批量读取<\/button>/);
  const retryFlow = source.slice(
    source.indexOf("async function retryBatchCandidate"),
    source.indexOf("async function exitBatchMode"),
  );
  assert.doesNotMatch(retryFlow, /selectRecordIds/);
  assert.doesNotMatch(retryFlow, /requestLoadRecords\(true\)/);
});

test("CT-BATCH-11-UI: all batch layouts share the same capacity and recovery transaction", () => {
  const source = readFileSync("src/App.vue", "utf8");
  const batchFlow = source.slice(
    source.indexOf("async function loadBatchCandidate"),
    source.indexOf("async function retryBatchCandidate"),
  );
  assert.equal((batchFlow.match(/prepareBatchCandidate\(/g) ?? []).length, 1);
  assert.match(batchFlow, /getBatchLayoutMode\(canonical\)/);
  assert.match(batchFlow, /ensureBatchLayout/);
  assert.match(batchFlow, /requestedRecordIds: candidateRequest\.recordIds/);
});
