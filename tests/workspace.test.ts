import assert from "node:assert/strict";
import test from "node:test";
import {
  EDITOR_PANELS,
  getTemplateStatus,
  initialWorkspaceMode,
  canEnterTemplateEdit,
  shouldGuardUnsavedNavigation,
  toggleWorkspaceMode,
  type TemplateStatusInput,
} from "../src/core/workspace.ts";

test("SPEC-UX-01: a loaded workspace starts in print preview and enters edit explicitly", () => {
  assert.equal(initialWorkspaceMode(), "preview");
  assert.equal(toggleWorkspaceMode("preview"), "edit");
  assert.equal(toggleWorkspaceMode("edit"), "preview");
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

test("SPEC-UX-03: the editor exposes the four MVP entry points in a stable order", () => {
  assert.deepEqual(EDITOR_PANELS, ["data-sources", "components", "page-settings", "settings"]);
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
