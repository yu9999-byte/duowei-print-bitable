import type { WorkspaceSurface } from "../core/workspace.ts";

export type WorkspacePresentation = {
  showBrand: boolean;
  showTemplateDirectory: boolean;
  showEditorPanel: boolean;
  showInlineEditorPanel: boolean;
  showBatchSummary: boolean;
  showWorkspaceToolbar: boolean;
  showRecordPicker: boolean;
  showExitBatch: boolean;
  showOutputs: boolean;
  showEditTemplate: boolean;
  showSave: boolean;
  showBack: boolean;
  showDesigner: boolean;
  showPreview: boolean;
};

const PRESENTATIONS: Record<WorkspaceSurface, WorkspacePresentation> = {
  "single-preview": {
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
  },
  "single-edit": {
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
  },
  "batch-preview": {
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
  },
  "batch-edit": {
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
  },
};

export function getWorkspacePresentation(surface: WorkspaceSurface): WorkspacePresentation {
  return { ...PRESENTATIONS[surface] };
}

export function getWorkspaceSidebarLayout(surface: WorkspaceSurface, viewportWidth: number) {
  const compact = viewportWidth <= 760;
  if (surface === "single-edit") return { width: compact ? 188 : 208, compact };
  return { width: compact ? 164 : 188, compact };
}
