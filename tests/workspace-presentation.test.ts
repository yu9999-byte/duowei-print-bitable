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
    showBrand: false,
    showTemplateDirectory: false,
    showEditorPanel: true,
    showInlineEditorPanel: false,
    showBatchSummary: false,
    showWorkspaceToolbar: false,
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

test("CT-UX-09: batch preview keeps its directory and exposes the current template edit entry", () => {
  assert.deepEqual(getWorkspacePresentation("batch-preview"), {
    showBrand: true,
    showTemplateDirectory: false,
    showEditorPanel: false,
    showInlineEditorPanel: false,
    showBatchSummary: true,
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

test("CT-UX-09: batch edit keeps the batch directory and changes only the right workspace", () => {
  assert.deepEqual(getWorkspacePresentation("batch-edit"), {
    showBrand: true,
    showTemplateDirectory: false,
    showEditorPanel: false,
    showInlineEditorPanel: true,
    showBatchSummary: true,
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
  assert.deepEqual(getWorkspaceSidebarLayout("batch-edit", 932), { width: 188, compact: false });
  assert.deepEqual(getWorkspaceSidebarLayout("single-edit", 932), { width: 208, compact: false });
  assert.deepEqual(getWorkspaceSidebarLayout("single-preview", 700), { width: 164, compact: true });
  assert.deepEqual(getWorkspaceSidebarLayout("batch-preview", 700), { width: 164, compact: true });
  assert.deepEqual(getWorkspaceSidebarLayout("batch-edit", 700), { width: 164, compact: true });
  assert.deepEqual(getWorkspaceSidebarLayout("single-edit", 700), { width: 188, compact: true });
});

test("CT-UX-09: App exposes one edit action and one save action per active surface", () => {
  const source = readFileSync("src/App.vue", "utf8");
  const editActions = source.match(/>编辑模板<\/button>/g) ?? [];
  const saveActions = source.match(/@click="saveTemplate\(\)">保存模板<\/button>/g) ?? [];
  const batchBackActions = source.match(/> 返回批量预览\s*<\/button>/g) ?? [];

  assert.equal(editActions.length, 1);
  assert.equal(saveActions.length, 2, "single-edit and batch-edit use mutually exclusive headers");
  assert.equal(batchBackActions.length, 1);
  assert.match(source, /<template v-if="workspaceSurface === 'batch-edit'">[\s\S]*?保存模板<\/button>[\s\S]*?<template v-else>/);
  assert.match(source, /<header v-else class="app-header app-header-edit">[\s\S]*?保存模板<\/button>[\s\S]*?<\/header>/);
  assert.doesNotMatch(source, /class="workspace-actions"[\s\S]*?保存模板<\/button>[\s\S]*?<\/div>/);
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
