import { isDetailLinkField, type NormalizedField, type PrintJob } from "./print-job.ts";
import { cloneJsonValue } from "./json-clone.ts";
import { DETAIL_TEMPLATE_ROWS, detailTokensFromTemplate, renderDetailTemplateRows } from "./detail-tables.ts";
import {
  createDataSourceTokenCodec,
  type DataSourceTokenCodec,
  type DataSourceTokenDefinition,
} from "./data-source-token-codec.ts";

export const FIELD_DATA_SOURCE_GROUP_ID = "__duowei_fields";
export const SYSTEM_DATA_SOURCE_GROUP_ID = "__duowei_system";
export const SYSTEM_PRINT_DATE_ID = "__duowei_system_print_date";
export const DATA_SOURCE_CLIPBOARD_MIME = "application/x-duowei-data-source";
const FIELD_PREFIX = "__duowei_field_";
const DATA_SOURCE_TOKEN_PATTERN = /^@[A-Za-z0-9_.-]+$/;
const DATA_SOURCE_TOKEN_GLOBAL_PATTERN = /@[A-Za-z0-9_.-]+/g;

export function fieldDataSourceId(fieldId: string): string {
  if (!fieldId.trim()) throw new Error("字段缺少稳定 ID");
  return FIELD_PREFIX + fieldId;
}

export function detailFieldDataSourceId(fieldId: string, columnField: string): string {
  const key = /^[A-Za-z0-9_.-]+$/.test(columnField) ? columnField
    : `__duowei_column_text_${Array.from(columnField).map((char) => char.codePointAt(0)!.toString(16)).join("_")}`;
  return `${fieldDataSourceId(fieldId)}.${key}`;
}

export function getDocumentVariables(job: PrintJob, index: number): Record<string, unknown> {
  const values = job.documents[index]?.values ?? {};
  const generatedAt = new Date(job.generatedAt);
  if (!Number.isFinite(generatedAt.getTime())) {
    throw new Error("打印任务生成时间无效：无法生成系统打印日期");
  }
  const printDate = [
    String(generatedAt.getFullYear()).padStart(4, "0"),
    String(generatedAt.getMonth() + 1).padStart(2, "0"),
    String(generatedAt.getDate()).padStart(2, "0"),
  ].join("-");
  const emptyLinks = Object.fromEntries(job.table.fields
    .filter(isDetailLinkField)
    .map((field) => {
      const rows = values[field.name];
      return [
        "__duowei_print_empty_" + field.id,
        Array.isArray(rows) && rows.length > 0 ? "" : "暂无关联记录",
      ];
    }));
  const data: Record<string, unknown> = {
    ...values,
    ...Object.fromEntries(job.table.fields.flatMap((field) =>
      Object.prototype.hasOwnProperty.call(values, field.name)
        ? [[fieldDataSourceId(field.id), values[field.name]]]
        : [])),
    ...emptyLinks,
    [SYSTEM_PRINT_DATE_ID]: printDate,
  };
  if (!("打印日期" in values)) data.打印日期 = printDate;
  for (const field of job.table.fields.filter(isDetailLinkField)) {
    const rows = values[field.name];
    if (!Array.isArray(rows)) continue;
    for (const column of field.detailColumns ?? field.arrayColumns ?? []) {
      data[detailFieldDataSourceId(field.id, column.field)] = rows.map((row) =>
        row && typeof row === "object" && !Array.isArray(row) ? row[column.field] ?? "" : "");
    }
  }
  return data;
}

export type DesignerDataSource = {
  id: string;
  label: string;
  isArray?: boolean;
  columns?: Array<{ field: string; header: string; width?: number }>;
  children?: DesignerDataSource[];
};

export type DesignerDataSourceGroup = DesignerDataSource & {
  children: DesignerDataSource[];
};

export type DataSourceClipboardPayload = {
  token: string;
  text: string;
  label: string;
  sourceId: string;
  mime: typeof DATA_SOURCE_CLIPBOARD_MIME;
};

export type TextSelection = {
  start: number;
  end: number;
};

function historicalFieldBindings(template: unknown): Record<string, string> {
  if (!template || typeof template !== "object" || Array.isArray(template)) return {};
  const ext = (template as Record<string, unknown>).ext;
  if (!ext || typeof ext !== "object" || Array.isArray(ext)) return {};
  const bindings = (ext as Record<string, unknown>).fieldBindings;
  if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) return {};
  return Object.fromEntries(Object.entries(bindings).filter((entry): entry is [string, string] =>
    typeof entry[1] === "string"));
}

function templateDataSourceDefinitions(template: unknown): DataSourceTokenDefinition[] {
  if (!template || typeof template !== "object" || Array.isArray(template)) return [];
  const ext = (template as Record<string, unknown>).ext;
  if (!ext || typeof ext !== "object" || Array.isArray(ext)) return [];
  const available = (ext as Record<string, unknown>).availableVariables;
  if (!Array.isArray(available)) return [];
  const definitions: DataSourceTokenDefinition[] = [];
  const visit = (items: unknown[]) => {
    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const source = item as Record<string, unknown>;
      if (typeof source.id === "string" && typeof source.label === "string"
          && !Array.isArray(source.children)) {
        definitions.push({ id: source.id, label: source.label });
      }
      if (Array.isArray(source.children)) visit(source.children);
    }
  };
  visit(available);
  return definitions;
}

export function createPrintJobDataSourceTokenCodec(
  job: PrintJob,
  template?: unknown,
): DataSourceTokenCodec {
  return createDataSourceTokenCodec([
    ...job.table.fields.map((field) => ({ id: fieldDataSourceId(field.id), label: field.name })),
    ...job.table.fields.filter(isDetailLinkField).flatMap((field) =>
      (field.detailColumns ?? field.arrayColumns ?? []).map((column) => ({
        id: detailFieldDataSourceId(field.id, column.field), label: `${field.name}.${column.header}`,
      }))),
    { id: SYSTEM_PRINT_DATE_ID, label: "打印日期" },
    ...job.table.fields.filter(isDetailLinkField).map((field) => ({
      id: `__duowei_print_empty_${field.id}`,
      label: `${field.name}（空数据提示）`,
    })),
  ], historicalFieldBindings(template));
}

function templateDataSourceTokenCodec(template: unknown): DataSourceTokenCodec | undefined {
  const definitions = templateDataSourceDefinitions(template);
  const historical = historicalFieldBindings(template);
  if (definitions.length === 0 && Object.keys(historical).length === 0) return undefined;
  return createDataSourceTokenCodec(definitions, historical);
}

function dataSourceToken(sourceId: string): string {
  const token = `@${sourceId}`;
  if (!DATA_SOURCE_TOKEN_PATTERN.test(token)) {
    throw new Error(`数据源 ID 无法生成稳定 Token：${sourceId}`);
  }
  return token;
}

export function buildDataSourceClipboardPayload(
  source: Pick<DesignerDataSource, "id" | "label">,
): DataSourceClipboardPayload {
  const token = dataSourceToken(source.id);
  return {
    token,
    text: `@${source.label}`,
    label: source.label,
    sourceId: source.id,
    mime: DATA_SOURCE_CLIPBOARD_MIME,
  };
}

export function parseDataSourceClipboardPayload(
  mime: string | null | undefined,
  text: string | null | undefined,
): { token: string } | null {
  if (mime !== DATA_SOURCE_CLIPBOARD_MIME || typeof text !== "string") return null;
  const token = text.trim();
  return DATA_SOURCE_TOKEN_PATTERN.test(token) ? { token } : null;
}

export function insertDataSourceToken(
  content: string,
  token: string,
  selection: TextSelection = { start: content.length, end: content.length },
): { content: string; selection: TextSelection } {
  if (!DATA_SOURCE_TOKEN_PATTERN.test(token)) {
    throw new Error(`无效的数据源 Token：${token}`);
  }
  const start = Math.max(0, Math.min(content.length, selection.start));
  const end = Math.max(start, Math.min(content.length, selection.end));
  const nextContent = content.slice(0, start) + token + content.slice(end);
  const cursor = start + token.length;
  return { content: nextContent, selection: { start: cursor, end: cursor } };
}

export function resolveDataSourceTokens(
  content: string,
  values: Record<string, unknown>,
): string {
  return content.replace(DATA_SOURCE_TOKEN_GLOBAL_PATTERN, (token) => {
    const key = token.slice(1);
    if (!Object.prototype.hasOwnProperty.call(values, key)) return token;
    const value = values[key];
    if (value === null || value === undefined) return "";
    if (Array.isArray(value)) return value.map((item) => String(item ?? "")).join(", ");
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  });
}

export function prepareTemplateForOutput(
  template: unknown,
  values: Record<string, unknown>,
  codec: DataSourceTokenCodec | undefined = templateDataSourceTokenCodec(template),
): { template: Record<string, unknown>; variables: Record<string, unknown> } {
  if (!template || typeof template !== "object" || Array.isArray(template)) {
    throw new Error("打印模板格式无效：无法准备多字段输出");
  }
  const cloned = cloneJsonValue(template) as Record<string, unknown>;
  const outputVariables = { ...values };
  const detailTokens = detailTokensFromTemplate(cloned);
  const pages = cloned.pages;
  if (!Array.isArray(pages)) return { template: cloned, variables: outputVariables };

  pages.forEach((page, pageIndex) => {
    if (!page || typeof page !== "object" || Array.isArray(page)) return;
    const elements = (page as Record<string, unknown>).elements;
    if (!Array.isArray(elements)) return;
    elements.forEach((element, elementIndex) => {
      if (!element || typeof element !== "object" || Array.isArray(element)) return;
      const item = element as Record<string, unknown>;
      if (item.type === "table" && Array.isArray(item[DETAIL_TEMPLATE_ROWS]) && codec) {
        const key = `__duowei_detail_rows_${pageIndex}_${elementIndex}`;
        outputVariables[key] = renderDetailTemplateRows(item[DETAIL_TEMPLATE_ROWS] as Record<string, any>[], detailTokens, values, codec);
        item.variable = `@${key}`;
        item.data = [];
        item.autoPaginate = true;
        return;
      }
      if (item.type !== "text") return;
      const content = typeof item.content === "string" ? item.content : "";
      const variable = typeof item.variable === "string" ? item.variable : "";
      const contentHasTokens = DATA_SOURCE_TOKEN_GLOBAL_PATTERN.test(content);
      DATA_SOURCE_TOKEN_GLOBAL_PATTERN.lastIndex = 0;
      if (!contentHasTokens && !variable) return;
      const source = contentHasTokens ? content : variable;
      const rendered = codec
        ? codec.toRenderedContent(source, values).content
        : resolveDataSourceTokens(source, values);
      const rawId = typeof item.id === "string" && item.id.trim()
        ? item.id
        : `${pageIndex}_${elementIndex}`;
      const key = `__duowei_render_${rawId.replace(/[^A-Za-z0-9_.-]/g, "_")}`;
      const token = `@${key}`;
      outputVariables[key] = rendered;
      item.content = token;
      item.variable = token;
    });
  });
  return { template: cloned, variables: outputVariables };
}

export function buildDataSourceCatalog(fields: NormalizedField[]): DesignerDataSourceGroup[] {
  return [
    {
      id: FIELD_DATA_SOURCE_GROUP_ID,
      label: "字段",
      children: fields.map((field) => ({
        id: fieldDataSourceId(field.id),
        label: field.name,
        ...(isDetailLinkField(field) ? {
          isArray: true,
          columns: field.detailColumns ?? field.arrayColumns ?? [],
          children: (field.detailColumns ?? field.arrayColumns ?? []).map((column) => ({
            id: detailFieldDataSourceId(field.id, column.field),
            label: `${field.name}.${column.header}`,
          })),
        } : {}),
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
  const cloned = cloneJsonValue(template) as Record<string, unknown>;
  const currentExt = cloned.ext && typeof cloned.ext === "object" && !Array.isArray(cloned.ext)
    ? cloned.ext as Record<string, unknown>
    : {};
  const previousBindings = currentExt.fieldBindings && typeof currentExt.fieldBindings === "object"
    ? currentExt.fieldBindings as Record<string, string> : {};
  const byName = new Map<string, string[]>();
  for (const field of fields) byName.set(field.name, [...(byName.get(field.name) ?? []), field.id]);
  const oldNames = new Map<string, string[]>();
  for (const [id, name] of Object.entries(previousBindings)) {
    oldNames.set(name, [...(oldNames.get(name) ?? []), id]);
  }
  const resolveToken = (token: string) => {
    if (token.startsWith(FIELD_PREFIX)) {
      // Keep missing stable IDs so the editor can show an explicit invalid binding
      // without replacing the user's template or guessing another field.
      return token;
    }
    if (token.startsWith("__duowei_")) return token;
    const previousIds = oldNames.get(token) ?? [];
    if (previousIds.length > 1) {
      throw new Error(`无法识别旧字段绑定：${token}；历史字段名不唯一`);
    }
    const previousId = previousIds[0];
    if (previousId && fields.some((field) => field.id === previousId)) return fieldDataSourceId(previousId);
    const matches = byName.get(token) ?? [];
    if (matches.length === 1) return fieldDataSourceId(matches[0]);
    if (matches.length > 1 || previousId || token.trim()) {
      throw new Error(`无法识别旧字段绑定：${token}；请核对字段是否改名或重名`);
    }
    return token;
  };
  const pages = cloned.pages;
  if (Array.isArray(pages)) for (const page of pages) {
    if (!page || typeof page !== "object" || !Array.isArray(page.elements)) continue;
    for (const element of page.elements) {
      if (!element || typeof element !== "object") continue;
      if (typeof element.variable === "string" && element.variable.startsWith("@")) {
        const oldToken = element.variable;
        const nextToken = `@${resolveToken(oldToken.slice(1))}`;
        element.variable = nextToken;
        if (typeof element.content === "string") {
          element.content = element.content.split(oldToken).join(nextToken);
        }
      }
      if (typeof element.content === "string") {
        DATA_SOURCE_TOKEN_GLOBAL_PATTERN.lastIndex = 0;
        element.content = element.content.replace(DATA_SOURCE_TOKEN_GLOBAL_PATTERN, (token: string) => {
          if (!token.startsWith("@__duowei_")) return token;
          return `@${resolveToken(token.slice(1))}`;
        });
      }
    }
  }
  return {
    ...cloned,
    ext: {
      ...currentExt,
      fieldBindings: {
        ...previousBindings,
        ...Object.fromEntries(fields.map((field) => [field.id, field.name])),
      },
      availableVariables: buildDataSourceCatalog(fields),
    },
  };
}
