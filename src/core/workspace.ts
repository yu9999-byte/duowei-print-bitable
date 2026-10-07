export type WorkspaceMode = "preview" | "edit";

export type WorkspaceSurface = "single-preview" | "single-edit" | "batch-preview";

export type TemplateSelection = "none" | "selected";

export type TemplateStatus = "automatic" | "saved" | "fallback" | "unsaved";

export type TemplateStatusInput = {
  hasStoredTemplate: boolean;
  canSave: boolean;
  dirty: boolean;
};

export type EditorPanel =
  | "data-sources"
  | "components";

export const EDITOR_PANELS: readonly EditorPanel[] = [
  "data-sources",
  "components",
];

export function initialWorkspaceMode(): WorkspaceMode {
  return "preview";
}

export function getWorkspaceSurface(mode: WorkspaceMode, batchMode: boolean): WorkspaceSurface {
  if (batchMode) return "batch-preview";
  return mode === "edit" ? "single-edit" : "single-preview";
}

export function toggleWorkspaceMode(mode: WorkspaceMode): WorkspaceMode {
  return mode === "preview" ? "edit" : "preview";
}

export function canEnterTemplateEdit(input: {
  templateLoaded: boolean;
  templateSelected: boolean;
}): boolean {
  return input.templateLoaded && input.templateSelected;
}

export function shouldGuardUnsavedNavigation(dirty: boolean): boolean {
  return dirty;
}

export function contextDecisionCancelStatus(request: "current" | "batch" | "exit" | null): string {
  return request === null
    ? "已保留当前模板草稿；宿主记录已切换，完成编辑后请重新读取"
    : "已保留当前模板草稿";
}

/**
 * Feishu may emit a transient selection event while an explicit record-load
 * request is being prepared. Such events can omit the record id (or repeat
 * the current one), but they do not represent a host-context switch.
 */
export function shouldIgnorePendingSelectionChange(input: {
  hasPendingExplicitLoad: boolean;
  current: { baseId: string; tableId: string; viewId: string; recordId: string | null };
  incoming: {
    baseId: string | null;
    tableId: string | null;
    viewId: string | null;
    recordId?: string | null;
  };
}): boolean {
  if (!input.hasPendingExplicitLoad) return false;
  if (input.current.baseId !== input.incoming.baseId
    || input.current.tableId !== input.incoming.tableId
    || input.current.viewId !== input.incoming.viewId) {
    return false;
  }
  return input.incoming.recordId == null || input.incoming.recordId === input.current.recordId;
}

export function modeAfterDiscardForLoadRequest(
  request: "current" | "batch" | "exit" | null,
  current: WorkspaceMode,
): WorkspaceMode {
  return request === "batch" || request === "exit" ? "preview" : current;
}

export function getTemplateDirtyState(input: {
  hasDraft: boolean;
  baseline: string;
  snapshot: string;
  dirty: boolean;
}): boolean {
  if (input.hasDraft) return true;
  if (!input.snapshot) return input.dirty || Boolean(input.baseline);
  if (!input.baseline) return input.dirty;
  return input.snapshot !== input.baseline;
}

export function getTemplateStatus(input: TemplateStatusInput): TemplateStatus {
  if (input.dirty) return "unsaved";
  if (!input.hasStoredTemplate) return "automatic";
  if (!input.canSave) return "fallback";
  return "saved";
}
