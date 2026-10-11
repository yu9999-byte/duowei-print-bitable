import type { PrintJob } from "./print-job.ts";

export const MAX_BATCH_RECORDS = 50;

export type BatchRecordSummary = {
  recordId: string;
  label: string;
};

export type BatchPrintSession = {
  mode: "single" | "batch";
  hostRecordId: string | null;
  committedRecordIds: string[];
  summaries: BatchRecordSummary[];
  templateId: string | null;
};

export type BatchCommitInput = {
  recordIds: string[];
  summaries: BatchRecordSummary[];
  templateId?: string | null;
};

export type BatchCommitResult =
  | { ok: true; session: BatchPrintSession }
  | { ok: false; message: string };

export type BatchRecordIdValidation =
  | { ok: true; recordIds: string[] }
  | { ok: false; message: string };

function uniqueRecordIds(recordIds: string[]): string[] {
  return Array.from(new Set(recordIds.filter(Boolean)));
}

export function validateBatchRecordIds(recordIds: readonly string[]): BatchRecordIdValidation {
  const normalized = uniqueRecordIds([...recordIds]);
  if (normalized.length === 0) {
    return { ok: false, message: "请至少选择一条记录；未更改当前打印批次" };
  }
  if (normalized.length > MAX_BATCH_RECORDS) {
    return { ok: false, message: `一次最多选择 ${MAX_BATCH_RECORDS} 条记录；未更改当前打印批次` };
  }
  return { ok: true, recordIds: normalized };
}

export function createSinglePrintSession(recordId: string | null): BatchPrintSession {
  return {
    mode: "single",
    hostRecordId: recordId,
    committedRecordIds: recordId ? [recordId] : [],
    summaries: recordId ? [{ recordId, label: recordId }] : [],
    templateId: null,
  };
}

export function summarizeBatch(job: PrintJob): BatchRecordSummary[] {
  const fields = job.table.fields;
  const primary = fields.find((field) => field.isPrimary)
    ?? (fields.every((field) => field.isPrimary === undefined)
      ? fields.find((field) => !field.isLink) : undefined);
  return job.documents.map((document) => {
    const value = primary ? document.values[primary.name] : undefined;
    return {
      recordId: document.recordId,
      label: typeof value === "string" && value.trim() ? value
        : typeof value === "number" ? String(value) : document.recordId,
    };
  });
}

export function commitBatchPrintSession(
  current: BatchPrintSession,
  input: BatchCommitInput,
): BatchCommitResult {
  const validation = validateBatchRecordIds(input.recordIds);
  if (!validation.ok) return validation;
  const { recordIds } = validation;
  const summaryById = new Map(input.summaries.map((item) => [item.recordId, item]));
  return {
    ok: true,
    session: {
      mode: "batch",
      hostRecordId: current.hostRecordId,
      committedRecordIds: recordIds,
      summaries: recordIds.map((recordId) => summaryById.get(recordId) ?? ({ recordId, label: recordId })),
      templateId: input.templateId ?? null,
    },
  };
}

export function exitBatchPrintSession(session: BatchPrintSession): BatchPrintSession {
  return createSinglePrintSession(session.hostRecordId);
}

export function shouldExitBatchOnTemplateSwitch(
  session: BatchPrintSession,
  targetTemplateId: string,
): boolean {
  return session.mode === "batch" && session.templateId !== targetTemplateId;
}

export function batchSessionRecordLabel(session: BatchPrintSession): string {
  return session.mode === "batch"
    ? `已选 ${session.committedRecordIds.length} 条`
    : "当前记录";
}
