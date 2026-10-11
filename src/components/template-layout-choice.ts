import { hasContinuousLayout } from "../core/continuous-layout.ts";
import { cloneJsonValue } from "../core/json-clone.ts";
import { hasNativeLabelGrid } from "../core/label-layout.ts";

export type BatchLayoutMode = "default" | "continuous" | "labels";

export const BATCH_LAYOUT_OPTIONS: ReadonlyArray<{
  kind: BatchLayoutMode;
  label: string;
  description: string;
}> = [
  { kind: "default", label: "默认排版", description: "每条记录按完整模板分别分页" },
  { kind: "continuous", label: "连续排版", description: "多条记录在一张长纸中连续排列" },
  { kind: "labels", label: "标签排版", description: "按标签行列与间距批量铺排" },
] as const;

type JsonRecord = Record<string, any>;

const METADATA_KEY = "duoweiBatchLayout";

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function metadata(template: unknown): JsonRecord | null {
  const source = record(template);
  const ext = record(source?.ext);
  return record(ext?.[METADATA_KEY]);
}

function validMode(value: unknown): value is BatchLayoutMode {
  return value === "default" || value === "continuous" || value === "labels";
}

export function getBatchLayoutMode(template: unknown): BatchLayoutMode {
  const explicit = metadata(template)?.mode;
  if (validMode(explicit)) return explicit;
  if (hasNativeLabelGrid(template)) return "labels";
  if (hasContinuousLayout(template)) return "continuous";
  return "default";
}

function withoutRuntimeMetadata(template: unknown): JsonRecord {
  const output = cloneJsonValue(template) as JsonRecord;
  const ext = record(output.ext) ?? {};
  delete ext[METADATA_KEY];
  delete ext.batchLayout;
  output.ext = ext;
  return output;
}

export function setBatchLayoutMode(template: unknown, mode: BatchLayoutMode): JsonRecord {
  const output = cloneJsonValue(template) as JsonRecord;
  const ext = record(output.ext) ?? {};
  const previous = record(ext[METADATA_KEY]) ?? {};
  delete ext.batchLayout;
  ext[METADATA_KEY] = { ...previous, version: 1, mode };
  output.ext = ext;
  return output;
}

export function ensureBatchLayout(
  template: unknown,
  mode: BatchLayoutMode,
  createLabelTemplate: () => unknown,
  createBaseTemplate: () => unknown,
): { persistentTemplate: JsonRecord; effectiveTemplate: JsonRecord } {
  const source = withoutRuntimeMetadata(template);
  const previous = metadata(template) ?? {};
  const legacyLabelRoot = hasNativeLabelGrid(source);
  const base = legacyLabelRoot
    ? withoutRuntimeMetadata(record(previous.baseTemplate) ?? createBaseTemplate())
    : source;
  if (hasNativeLabelGrid(base)) {
    throw new Error("历史标签模板缺少可用于默认排版的基础画布");
  }

  const persistentTemplate = cloneJsonValue(base) as JsonRecord;
  const ext = record(persistentTemplate.ext) ?? {};
  delete ext.batchLayout;
  const config: JsonRecord = { ...previous, version: 1, mode };
  delete config.baseTemplate;
  if (!record(config.labelTemplate) && legacyLabelRoot) {
    config.labelTemplate = source;
  }
  if (mode === "labels" && !record(config.labelTemplate)) {
    config.labelTemplate = withoutRuntimeMetadata(createLabelTemplate());
  }
  ext[METADATA_KEY] = config;
  persistentTemplate.ext = ext;
  let effectiveTemplate: JsonRecord;
  if (mode === "labels") {
    effectiveTemplate = withoutRuntimeMetadata(config.labelTemplate);
  } else {
    effectiveTemplate = withoutRuntimeMetadata(persistentTemplate);
    if (mode === "continuous") {
      const effectiveExt = record(effectiveTemplate.ext) ?? {};
      effectiveExt.batchLayout = "continuous";
      effectiveTemplate.ext = effectiveExt;
    }
  }
  return { persistentTemplate, effectiveTemplate };
}

export function mergeEditedBatchLayout(
  persistentTemplate: unknown,
  editedTemplate: unknown,
  mode: BatchLayoutMode,
): JsonRecord {
  const canonical = setBatchLayoutMode(persistentTemplate, mode);
  const canonicalExt = record(canonical.ext)!;
  const config = record(canonicalExt[METADATA_KEY])!;
  if (mode === "labels") {
    config.labelTemplate = withoutRuntimeMetadata(editedTemplate);
    return canonical;
  }
  const edited = withoutRuntimeMetadata(editedTemplate);
  const editedExt = record(edited.ext) ?? {};
  editedExt[METADATA_KEY] = cloneJsonValue(config);
  edited.ext = editedExt;
  return edited;
}

export function mergeEditedBaseTemplate(
  persistentTemplate: unknown,
  editedTemplate: unknown,
): JsonRecord {
  const mode = getBatchLayoutMode(persistentTemplate);
  const canonical = setBatchLayoutMode(persistentTemplate, mode);
  const config = record(record(canonical.ext)?.[METADATA_KEY])!;
  if (!record(config.labelTemplate) && hasNativeLabelGrid(persistentTemplate)) {
    config.labelTemplate = withoutRuntimeMetadata(persistentTemplate);
  }
  const edited = withoutRuntimeMetadata(editedTemplate);
  const editedExt = record(edited.ext) ?? {};
  editedExt[METADATA_KEY] = cloneJsonValue(config);
  edited.ext = editedExt;
  return edited;
}

// Temporary aliases keep older internal callers compiling while Goal v15 moves
// all user-facing semantics to the explicit batch-layout names above.
export type TemplateLayoutKind = BatchLayoutMode;
export const TEMPLATE_LAYOUT_OPTIONS = BATCH_LAYOUT_OPTIONS;
export const getTemplateLayoutKind = getBatchLayoutMode;
