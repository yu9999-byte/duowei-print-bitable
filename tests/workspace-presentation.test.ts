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

test("CT-UX-09: batch preview is read-only and owns batch recovery/output actions", () => {
  assert.deepEqual(getWorkspacePresentation("batch-preview"), {
    showBrand: true,
    showTemplateDirectory: false,
    showEditorPanel: false,
    showBatchSummary: true,
    showWorkspaceToolbar: true,
    showRecordPicker: true,
    showExitBatch: true,
    showOutputs: true,
    showEditTemplate: false,
    showSave: false,
    showBack: false,
    showDesigner: false,
    showPreview: true,
  });
});

test("CT-UX-10: canvas-first sidebar stays compact without shrinking the editor panel", () => {
  assert.deepEqual(getWorkspaceSidebarLayout("single-preview", 932), { width: 188, compact: false });
  assert.deepEqual(getWorkspaceSidebarLayout("batch-preview", 932), { width: 188, compact: false });
  assert.deepEqual(getWorkspaceSidebarLayout("single-edit", 932), { width: 208, compact: false });
  assert.deepEqual(getWorkspaceSidebarLayout("single-preview", 700), { width: 164, compact: true });
  assert.deepEqual(getWorkspaceSidebarLayout("single-edit", 700), { width: 188, compact: true });
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

test("CT-UX-08/10: the visual shell declares Feishu tokens and one scroll owner", () => {
  const source = readFileSync("src/App.vue", "utf8");
  assert.match(source, /--ui-primary:\s*#3370ff/i);
  assert.match(source, /--ui-workspace:\s*#f2f3f5/i);
  assert.match(source, /\.app-shell\s*\{[^}]*height:\s*100dvh/s);
  assert.match(source, /\.preview-surface\s*\{[^}]*overflow:\s*auto/s);
  assert.match(source, /\.preview-frame\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(source, /@media\s*\(max-width:\s*760px\)/);
});
