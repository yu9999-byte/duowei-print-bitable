import { bitable, ViewType, type ITable } from "@lark-base-open/js-sdk";
import { DEFAULT_READ_TIMEOUT_MS, withReadTimeout } from "./read-timeout.ts";
import { isTableViewHost, tableViewRecord } from "./plugin-host.ts";

let sourceViewId: string | null = null;
export function setSourceViewId(id: string) { sourceViewId = id; }

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
    recordId: isTableViewHost ? tableViewRecord({ baseId: selection.baseId, tableId: selection.tableId, viewId: selection.viewId }) : selection.recordId ?? null,
  };
}

export function getCurrentRecordIds(selection: FeishuSelection): string[] {
  return selection.recordId ? [selection.recordId] : [];
}

export async function getInitialTableViewRecord(
  selection: FeishuSelection,
  preferredViewId: string,
  getTable: (tableId: string) => PromiseLike<Pick<ITable, "getViewMetaList" | "getRecordIdListByPage">>
    = (tableId) => bitable.base.getTable(tableId),
  timeoutMs = DEFAULT_READ_TIMEOUT_MS,
) {
  const table = await withReadTimeout("获取数据表", getTable(selection.tableId), timeoutMs);
  const views = (await withReadTimeout("获取数据视图", table.getViewMetaList(), timeoutMs))
    .filter((view) => view.type !== ViewType.WidgetView && view.type !== ViewType.Form)
    .map(({ id, name }) => ({ id, name }));
  const sourceViewId = views.find((view) => view.id === preferredViewId)?.id ?? views[0]?.id ?? "";
  // The source view supplies its filtering and ordering; never fall back to an unrelated row.
  const page = sourceViewId
    ? await withReadTimeout("读取第一条记录", table.getRecordIdListByPage({ viewId: sourceViewId, pageSize: 1 }), timeoutMs)
    : null;
  return { views, sourceViewId, recordId: page?.recordIds[0] ?? null };
}

export async function selectRecordIds(
  selection: FeishuSelection,
  openPicker: (
    tableId: string,
    viewId: string,
  ) => PromiseLike<string[]> = (tableId, viewId) =>
    bitable.ui.selectRecordIdList(tableId, viewId),
): Promise<string[]> {
  const ids = await openPicker(selection.tableId, isTableViewHost ? sourceViewId ?? selection.viewId : selection.viewId);
  return Array.from(new Set(ids.filter(Boolean)));
}
