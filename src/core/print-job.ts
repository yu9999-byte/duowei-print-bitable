import { cloneJsonValue } from "./json-clone.ts";

export type PrintableValue =
  | string
  | number
  | boolean
  | null
  | PrintableValue[]
  | { [fieldName: string]: PrintableValue };

export type NormalizedField = {
  id: string;
  name: string;
  type: string;
  isPrimary?: boolean;
  isLongText?: boolean;
  isLink?: boolean;
  linkKind?: "reference" | "detail";
  arrayColumns?: Array<{ field: string; header: string; width?: number }>;
  /** All selectable linked columns, keyed by stable target-field ID. */
  detailColumns?: Array<{ field: string; header: string; width?: number }>;
};

export function isDetailLinkField(field: NormalizedField): boolean {
  if (field.linkKind) return field.linkKind === "detail";
  return Boolean(field.isLink || field.arrayColumns);
}

export function isReferenceLinkField(field: NormalizedField): boolean {
  return field.isLink === true && field.linkKind === "reference";
}

export type PrintDocument = {
  recordId: string;
  values: Record<string, PrintableValue>;
};

export type PrintJob = {
  source: { baseId: string; tableId: string; recordIds: string[] };
  table: { name: string; fields: NormalizedField[] };
  documents: PrintDocument[];
  generatedAt: string;
};

export type BuildPrintJobInput = {
  source: { baseId: string; tableId: string };
  table: PrintJob["table"];
  selectedIds: string[];
  records: PrintDocument[];
  generatedAt: string;
};

export function buildPrintJob(input: BuildPrintJobInput): PrintJob {
  const selectedIds = [...new Set(input.selectedIds)];
  if (selectedIds.length === 0) {
    throw new Error("请先在当前表选中至少一条记录");
  }

  const recordsById = new Map<string, PrintDocument>();
  for (const record of input.records) {
    if (recordsById.has(record.recordId)) {
      throw new Error(`记录读取结果包含重复 ID：${record.recordId}`);
    }
    recordsById.set(record.recordId, record);
  }

  const missingIds = selectedIds.filter((id) => !recordsById.has(id));
  if (missingIds.length > 0) {
    throw new Error(`所选记录读取不完整：${missingIds.join("、")}`);
  }

  return {
    source: { ...input.source, recordIds: selectedIds },
    table: cloneJsonValue(input.table),
    documents: selectedIds.map((recordId) => ({
      recordId,
      values: cloneJsonValue(recordsById.get(recordId)!.values),
    })),
    generatedAt: input.generatedAt,
  };
}
