import assert from "node:assert/strict";
import test from "node:test";
import {
  EDITOR_PANELS,
  getTemplateStatus,
  getTemplateDirtyState,
  getWorkspaceSurface,
  initialWorkspaceMode,
  canEnterTemplateEdit,
  contextDecisionCancelStatus,
  modeAfterDiscardForLoadRequest,
  shouldIgnorePendingSelectionChange,
  shouldGuardUnsavedNavigation,
  toggleWorkspaceMode,
  type TemplateStatusInput,
} from "../src/core/workspace.ts";
import { normalizeTemplateName } from "../src/components/template-management.ts";

test("SPEC-UX-01: a loaded workspace starts in print preview and enters edit explicitly", () => {
  assert.equal(initialWorkspaceMode(), "preview");
  assert.equal(toggleWorkspaceMode("preview"), "edit");
  assert.equal(toggleWorkspaceMode("edit"), "preview");
});

test("SPEC-BATCH-08: a committed batch preserves preview and edit as distinct surfaces", () => {
  assert.equal(getWorkspaceSurface("preview", false), "single-preview");
  assert.equal(getWorkspaceSurface("edit", false), "single-edit");
  assert.equal(getWorkspaceSurface("preview", true), "batch-preview");
  assert.equal(getWorkspaceSurface("edit", true), "batch-edit");
});

test("SPEC-UX-02: template status distinguishes automatic, saved, fallback, and unsaved states", () => {
  const cases: Array<[TemplateStatusInput, string]> = [
    [{ hasStoredTemplate: false, canSave: true, dirty: false }, "automatic"],
    [{ hasStoredTemplate: true, canSave: true, dirty: false }, "saved"],
    [{ hasStoredTemplate: true, canSave: false, dirty: false }, "fallback"],
    [{ hasStoredTemplate: true, canSave: true, dirty: true }, "unsaved"],
    [{ hasStoredTemplate: false, canSave: true, dirty: true }, "unsaved"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(getTemplateStatus(input), expected);
  }
});

test("SPEC-UX-03: only actionable data sources and components are exposed", () => {
  assert.deepEqual(EDITOR_PANELS, ["data-sources", "components"]);
});

test("SPEC-UX-11: template names are trimmed and blank names are rejected", () => {
  assert.equal(normalizeTemplateName("  发货单  "), "发货单");
  assert.equal(normalizeTemplateName("   "), null);
  assert.equal(normalizeTemplateName("\n\t"), null);
});

test("SPEC-UX-04: editing requires an explicitly selected loaded template", () => {
  assert.equal(canEnterTemplateEdit({ templateLoaded: false, templateSelected: false }), false);
  assert.equal(canEnterTemplateEdit({ templateLoaded: true, templateSelected: false }), false);
  assert.equal(canEnterTemplateEdit({ templateLoaded: true, templateSelected: true }), true);
});

test("SPEC-UX-05/SPEC-SAVE-03: dirty navigation always requires a decision", () => {
  assert.equal(shouldGuardUnsavedNavigation(false), false);
  assert.equal(shouldGuardUnsavedNavigation(true), true);
});

test("SPEC-UX-05/SPEC-SAVE-03: a new unsaved template stays dirty even with identical canvas data", () => {
  assert.equal(getTemplateDirtyState({ hasDraft: true, baseline: "same", snapshot: "same", dirty: true }), true);
  assert.equal(getTemplateDirtyState({ hasDraft: false, baseline: "old", snapshot: "new", dirty: false }), true);
  assert.equal(getTemplateDirtyState({ hasDraft: false, baseline: "same", snapshot: "same", dirty: true }), false);
  assert.equal(getTemplateDirtyState({ hasDraft: false, baseline: "old", snapshot: "", dirty: true }), true);
});

test("SPEC-BATCH-08: continuing an explicit batch request must not claim the host switched", () => {
  assert.equal(contextDecisionCancelStatus("batch"), "已保留当前模板草稿");
  assert.equal(contextDecisionCancelStatus("current"), "已保留当前模板草稿");
  assert.match(contextDecisionCancelStatus(null), /宿主记录已切换/);
});

test("SPEC-BATCH-08: transient selection events do not clear an explicit load request", () => {
  const current = { baseId: "base", tableId: "table", viewId: "view", recordId: "rec-1" };
  assert.equal(shouldIgnorePendingSelectionChange({
    hasPendingExplicitLoad: true,
    current,
    incoming: { baseId: "base", tableId: "table", viewId: "view", recordId: null },
  }), true);
  assert.equal(shouldIgnorePendingSelectionChange({
    hasPendingExplicitLoad: true,
    current,
    incoming: { baseId: "base", tableId: "table", viewId: "view", recordId: "rec-1" },
  }), true);
  assert.equal(shouldIgnorePendingSelectionChange({
    hasPendingExplicitLoad: true,
    current,
    incoming: { baseId: "base", tableId: "table", viewId: "view", recordId: "rec-2" },
  }), false);
  assert.equal(shouldIgnorePendingSelectionChange({
    hasPendingExplicitLoad: false,
    current,
    incoming: { baseId: "base", tableId: "table", viewId: "view", recordId: null },
  }), false);
});

test("SPEC-BATCH-08: explicitly discarding a draft leaves a printable single preview before picking", () => {
  assert.equal(modeAfterDiscardForLoadRequest("batch", "edit"), "preview");
  assert.equal(modeAfterDiscardForLoadRequest("exit", "edit"), "preview");
  assert.equal(modeAfterDiscardForLoadRequest("current", "edit"), "edit");
});
