import type { NormalizedField } from "./print-job.ts";

export const FIELD_DATA_SOURCE_GROUP_ID = "__duowei_fields";
export const SYSTEM_DATA_SOURCE_GROUP_ID = "__duowei_system";
export const SYSTEM_PRINT_DATE_ID = "__duowei_system_print_date";
export const DESIGNER_VARIABLE_DRAG_MIME = "application/x-print-designer-variable";
export const DESIGNER_DATA_VARIABLE_DRAG_MIME = "application/x-print-designer-data-variable";

export type DesignerDataSource = {
  id: string;
  label: string;
  isArray?: boolean;
  children?: DesignerDataSource[];
};

export type DesignerDataSourceGroup = DesignerDataSource & {
  children: DesignerDataSource[];
};

export type DataSourceDragPayload =
  | { type: "text"; variable: string }
  | { type: "table"; dataVariable: string };

export function buildDataSourceDragPayload(source: DesignerDataSource): DataSourceDragPayload {
  if (source.isArray) return { type: "table", dataVariable: source.id };
  return { type: "text", variable: source.id };
}

export function buildDataSourceCatalog(fields: NormalizedField[]): DesignerDataSourceGroup[] {
  return [
    {
      id: FIELD_DATA_SOURCE_GROUP_ID,
      label: "字段",
      children: fields.map((field) => ({
        id: field.name,
        label: field.name,
        ...(field.isLink || field.arrayColumns ? { isArray: true } : {}),
      })),
    },
    {
      id: SYSTEM_DATA_SOURCE_GROUP_ID,
      label: "系统",
      children: [{ id: SYSTEM_PRINT_DATE_ID, label: "打印日期" }],
    },
  ];
}

export function refreshTemplateDataSources(
  template: unknown,
  fields: NormalizedField[],
): Record<string, unknown> & {
  ext: Record<string, unknown> & { availableVariables: DesignerDataSourceGroup[] };
} {
  if (!template || typeof template !== "object" || Array.isArray(template)) {
    throw new Error("打印模板格式无效：无法刷新数据源");
  }
  const cloned = structuredClone(template) as Record<string, unknown>;
  const currentExt = cloned.ext && typeof cloned.ext === "object" && !Array.isArray(cloned.ext)
    ? cloned.ext as Record<string, unknown>
    : {};
  return {
    ...cloned,
    ext: {
      ...currentExt,
      availableVariables: buildDataSourceCatalog(fields),
    },
  };
}
