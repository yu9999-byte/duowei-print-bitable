declare const __DUOWEI_PLUGIN_HOST__: "record" | "table";
export const isTableViewHost = typeof __DUOWEI_PLUGIN_HOST__ !== "undefined" && __DUOWEI_PLUGIN_HOST__ === "table";

type TableViewContext = { baseId: string; tableId: string; viewId: string };
let current: (TableViewContext & { recordId: string | null; sourceViewId: string; explicit: boolean }) | null = null;
export function rememberTableViewRecord(context: TableViewContext, recordId: string | null,
  options: { sourceViewId: string; explicit: boolean }) {
  current = { ...context, recordId, ...options };
}
export function tableViewRecord(context: TableViewContext): string | null {
  return current && current.baseId === context.baseId && current.tableId === context.tableId && current.viewId === context.viewId ? current.recordId : null;
}

export function resolveTableViewRecord(context: TableViewContext, source: { sourceViewId: string; recordId: string | null }): string | null {
  if (current?.explicit && current.sourceViewId === source.sourceViewId && tableViewRecord(context)) {
    return current.recordId;
  }
  rememberTableViewRecord(context, source.recordId, { sourceViewId: source.sourceViewId, explicit: false });
  return source.recordId;
}
