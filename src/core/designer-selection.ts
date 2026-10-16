type JsonRecord = Record<string, unknown>;

const layerActionLabels = ["置于顶层", "置于底层", "上移一层", "下移一层"];

export function isExplicitLayerActionControl(target: {
  tagName: string;
  role?: string | null;
  ariaLabel?: string | null;
  title?: string | null;
  text?: string | null;
}): boolean {
  const role = target.role?.toLowerCase();
  const actionable = target.tagName.toUpperCase() === "BUTTON"
    || role === "button" || role === "menuitem" || role === "menuitemradio";
  if (!actionable) return false;
  const label = `${target.ariaLabel ?? ""} ${target.title ?? ""} ${target.text ?? ""}`;
  return layerActionLabels.some((candidate) => label.includes(candidate));
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function zIndex(value: JsonRecord | null): unknown {
  return asRecord(value?.style)?.zIndex;
}

/**
 * vue-print-designer@1.7.39 raises a selected element by changing zIndex.
 * That is an engine selection side effect, not a template edit. Keep a real
 * layer operation opt-in while making selection-only snapshots stable.
 */
export function withoutImplicitSelectionLayering(
  snapshot: string,
  baseline: string,
  preserveLayering = false,
): string {
  if (preserveLayering || !snapshot || !baseline) return snapshot;
  try {
    const current = JSON.parse(snapshot) as JsonRecord;
    const original = JSON.parse(baseline) as JsonRecord;
    const originals = new Map<string, unknown>();
    const pages = Array.isArray(original.pages) ? original.pages : [];
    for (const page of pages) {
      const pageRecord = asRecord(page);
      const elements = Array.isArray(pageRecord?.elements) ? pageRecord.elements : [];
      for (const element of elements) {
        const record = asRecord(element);
        const id = typeof record?.id === "string" ? record.id : "";
        if (id) originals.set(id, zIndex(record));
      }
    }
    const currentPages = Array.isArray(current.pages) ? current.pages : [];
    for (const page of currentPages) {
      const pageRecord = asRecord(page);
      const elements = Array.isArray(pageRecord?.elements) ? pageRecord.elements : [];
      for (const element of elements) {
        const record = asRecord(element);
        const id = typeof record?.id === "string" ? record.id : "";
        if (!record || !id || !originals.has(id)) continue;
        const style = asRecord(record.style);
        const originalZ = originals.get(id);
        if (!style || style.zIndex === originalZ) continue;
        record.style = { ...style, zIndex: originalZ };
      }
    }
    return JSON.stringify(current);
  } catch {
    return snapshot;
  }
}

export function restoreImplicitSelectionLayering<T>(
  template: T,
  baseline: string,
  preserveLayering = false,
): T {
  if (preserveLayering || !baseline) return template;
  const normalized = withoutImplicitSelectionLayering(JSON.stringify(template), baseline, false);
  try {
    return JSON.parse(normalized) as T;
  } catch {
    return template;
  }
}
