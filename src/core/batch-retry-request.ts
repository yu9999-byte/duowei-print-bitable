import { validateBatchRecordIds } from "./batch-print-session.ts";

export type BatchRetryContext = Readonly<{
  baseId: string;
  tableId: string;
  viewId: string;
  recordId: string | null;
}>;

export type BatchRetryRequest = Readonly<{
  context: BatchRetryContext;
  templateId: string;
  recordIds: readonly string[];
}>;

export function createBatchRetryRequest(
  context: BatchRetryContext,
  templateId: string,
  recordIds: readonly string[],
): BatchRetryRequest {
  const validation = validateBatchRecordIds(recordIds);
  if (!validation.ok) throw new Error(validation.message);
  return Object.freeze({
    context: Object.freeze({ ...context }),
    templateId,
    recordIds: Object.freeze([...validation.recordIds]),
  });
}

export function isBatchRetryRequestCurrent(
  request: BatchRetryRequest,
  context: BatchRetryContext,
  templateId: string | null,
): boolean {
  return request.templateId === templateId
    && request.context.baseId === context.baseId
    && request.context.tableId === context.tableId
    && request.context.viewId === context.viewId
    && request.context.recordId === context.recordId;
}
