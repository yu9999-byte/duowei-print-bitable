import { cloneJsonValue } from "./json-clone.ts";
import type { DataSourceTokenCodec } from "./data-source-token-codec.ts";

type JsonRecord = Record<string, any>;
export type DetailToken = { id: string; sourceId: string; column: string };
export const DETAIL_TEMPLATE_ROWS = "detailTemplateRows";
const TOKEN_RE = /@__duowei_field_[A-Za-z0-9_.-]+/g;

export function detailTokensFromTemplate(template: JsonRecord): DetailToken[] {
  const result: DetailToken[] = [];
  const visit = (items: JsonRecord[]) => {
    for (const item of items) {
      if (item.isArray && Array.isArray(item.columns)) {
        item.columns.forEach((column: JsonRecord, index: number) => result.push({
          id: item.children?.[index]?.id ?? `${item.id}.${column.field}`, sourceId: item.id, column: column.field,
        }));
      }
      if (Array.isArray(item.children)) visit(item.children);
    }
  };
  visit(template.ext?.availableVariables ?? []);
  return result;
}

export function mapDetailRowText(rows: JsonRecord[], map: (text: string, cellKey: string) => string): JsonRecord[] {
  return rows.map((row, rowIndex) => Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (typeof value === "string") return [key, map(value, `${rowIndex}:${key}`)];
    if (value && typeof value === "object" && !Array.isArray(value) && typeof value.value === "string") {
      return [key, { ...value, value: map(value.value, `${rowIndex}:${key}`) }];
    }
    return [key, cloneJsonValue(value)];
  })));
}

export function rowDetailSource(row: JsonRecord, definitions: DetailToken[]): string | undefined {
  const byId = new Map(definitions.map((item) => [item.id, item]));
  const sources = new Set<string>();
  mapDetailRowText([row], (text) => {
    for (const token of text.match(TOKEN_RE) ?? []) {
      const definition = byId.get(token.slice(1));
      if (definition) sources.add(definition.sourceId);
      else if (token.includes(".__duowei_column_")) throw new Error("明细字段已失效，请从数据源重新复制字段");
    }
    return text;
  });
  if (sources.size > 1) throw new Error("同一循环行不能混用不同明细数据源，请放入不同表格或循环区域");
  return [...sources][0];
}

/** Repeat adjacent template rows as one region, retaining fixed rows and cell styles. */
export function renderDetailTemplateRows(
  rows: JsonRecord[], definitions: DetailToken[], values: Record<string, unknown>, codec: DataSourceTokenCodec,
): JsonRecord[] {
  const output: JsonRecord[] = [];
  for (let index = 0; index < rows.length;) {
    const sourceId = rowDetailSource(rows[index], definitions);
    if (!sourceId) {
      output.push(...mapDetailRowText([rows[index++]], (text) => codec.toRenderedContent(text, values).content));
      continue;
    }
    const start = index++;
    while (index < rows.length && rowDetailSource(rows[index], definitions) === sourceId) index++;
    const sourceRows = values[sourceId];
    if (!Array.isArray(sourceRows)) throw new Error("关联明细数据不可读取，请重新读取当前记录");
    for (const sourceRow of sourceRows) {
      if (!sourceRow || typeof sourceRow !== "object" || Array.isArray(sourceRow)) throw new Error("关联明细行格式无效");
      const record = sourceRow as JsonRecord;
      const rowValues = { ...values };
      for (const definition of definitions.filter((item) => item.sourceId === sourceId)) {
        rowValues[definition.id] = record[definition.column] ?? "";
      }
      output.push(...mapDetailRowText(rows.slice(start, index), (text) => codec.toRenderedContent(text, rowValues).content));
    }
  }
  return output;
}
