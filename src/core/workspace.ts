export type WorkspaceMode = "preview" | "edit";

export type TemplateSelection = "none" | "selected";

export type TemplateStatus = "automatic" | "saved" | "fallback" | "unsaved";

export type TemplateStatusInput = {
  hasStoredTemplate: boolean;
  canSave: boolean;
  dirty: boolean;
};

export type EditorPanel =
  | "data-sources"
  | "components"
  | "page-settings"
  | "settings";

export const EDITOR_PANELS: readonly EditorPanel[] = [
  "data-sources",
  "components",
  "page-settings",
  "settings",
];

export function initialWorkspaceMode(): WorkspaceMode {
  return "preview";
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

export function getTemplateStatus(input: TemplateStatusInput): TemplateStatus {
  if (input.dirty) return "unsaved";
  if (!input.hasStoredTemplate) return "automatic";
  if (!input.canSave) return "fallback";
  return "saved";
}
