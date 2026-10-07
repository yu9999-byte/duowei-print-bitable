import { bitable } from "@lark-base-open/js-sdk";
import { DEFAULT_READ_TIMEOUT_MS, withReadTimeout } from "./read-timeout.ts";

export type FeishuSelection = {
  baseId: string;
  tableId: string;
  viewId: string;
  recordId: string | null;
};

export function sameContext(
  left: FeishuSelection,
  right: {
    baseId: string | null;
    tableId: string | null;
    viewId: string | null;
    recordId?: string | null;
  },
): boolean {
  return left.baseId === right.baseId
    && left.tableId === right.tableId
    && left.viewId === right.viewId
    && (right.recordId === undefined || left.recordId === right.recordId);
}

export async function getActiveSelection(
  timeoutMs = DEFAULT_READ_TIMEOUT_MS,
  readSelection: () => PromiseLike<{
    baseId?: string | null;
    tableId?: string | null;
    viewId?: string | null;
    recordId?: string | null;
  }> = () => bitable.base.getSelection(),
): Promise<FeishuSelection> {
  const selection = await withReadTimeout(
    "获取当前多维表格选择",
    readSelection(),
    timeoutMs,
  );
  if (!selection.baseId || !selection.tableId || !selection.viewId) {
    throw new Error("无法识别当前多维表格、数据表或视图");
  }
  return {
    baseId: selection.baseId,
    tableId: selection.tableId,
    viewId: selection.viewId,
    recordId: selection.recordId ?? null,
  };
}

export function getCurrentRecordIds(selection: FeishuSelection): string[] {
  return selection.recordId ? [selection.recordId] : [];
}

export async function selectRecordIds(
  selection: FeishuSelection,
  openPicker: (
    tableId: string,
    viewId: string,
  ) => PromiseLike<string[]> = (tableId, viewId) =>
    bitable.ui.selectRecordIdList(tableId, viewId),
): Promise<string[]> {
  const ids = await openPicker(selection.tableId, selection.viewId);
  return Array.from(new Set(ids.filter(Boolean)));
}
