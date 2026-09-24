import { bitable, FieldType, type IFieldMeta, type IOpenLink } from "@lark-base-open/js-sdk";
import {
  expandLinkedRecords,
  type LinkCellValue,
  type LinkedTableReader,
} from "../core/linked-records.ts";
import type { NormalizedField } from "../core/print-job.ts";
import { buildPrintJob, type PrintJob } from "../core/print-job.ts";
import type { FeishuSelection } from "./feishu-context.ts";

function unreadableFieldValue(fieldName: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const reason = message.replace(/\s+/g, " ").trim().slice(0, 120) || "未知原因";
  return `【字段不可读取：${fieldName}（${reason}）】`;
}

function isLinkField(field: IFieldMeta): boolean {
  return field.type === FieldType.SingleLink || field.type === FieldType.DuplexLink;
}

function toLinkCellValue(value: unknown, field: IFieldMeta): LinkCellValue {
  const link = value && typeof value === "object" ? value as Partial<IOpenLink> : undefined;
  const property = "property" in field && field.property && "tableId" in field.property
    ? field.property
    : undefined;
  const tableId = link?.tableId ?? link?.table_id ?? property?.tableId;
  if (!tableId) {
    throw new Error(`关联字段缺少目标表：${field.name}`);
  }
  const recordIds = link?.recordIds ?? link?.record_ids ?? [];
  if (!Array.isArray(recordIds)
    || recordIds.some((recordId) => typeof recordId !== "string" || !recordId)) {
    throw new Error(`关联字段记录 ID 无效：${field.name}`);
  }
  return {
    tableId,
    recordIds,
    text: typeof link?.text === "string" ? link.text : "",
  };
}

export async function loadPrintJob(selection: FeishuSelection, recordIds: string[]): Promise<PrintJob> {
  const table = await bitable.base.getTable(selection.tableId);
  const [meta, name] = await Promise.all([table.getFieldMetaList(), table.getName()]);
  const linkedReaders = new Map<string, Promise<LinkedTableReader>>();
  const linkedColumns = new Map<string, NormalizedField["arrayColumns"]>();
  const fieldCache = new Map<string, ReturnType<typeof table.getFieldById>>();

  const getCellString = async (recordId: string, field: IFieldMeta): Promise<string> => {
    try {
      let readableField = fieldCache.get(field.id);
      if (!readableField) {
        readableField = table.getFieldById(field.id);
        fieldCache.set(field.id, readableField);
      }
      return await (await readableField).getCellString(recordId);
    } catch (error) {
      return unreadableFieldValue(field.name, error);
    }
  };

  const getLinkedReader = (tableId: string): Promise<LinkedTableReader> => {
    const cached = linkedReaders.get(tableId);
    if (cached) return cached;
    const pending = (async (): Promise<LinkedTableReader> => {
      const linkedTable = await bitable.base.getTable(tableId);
      const linkedTableCompat = linkedTable as typeof linkedTable & {
        getViewList?: () => Promise<Array<{ getFieldMetaList: () => Promise<IFieldMeta[]> }>>;
      };
      const linkedView = linkedTableCompat.getViewList
        ? (await linkedTableCompat.getViewList())[0]
        : await (async () => {
          const linkedViewMeta = (await linkedTable.getViewMetaList())[0];
          return linkedViewMeta ? linkedTable.getViewById(linkedViewMeta.id) : undefined;
        })();
      if (!linkedView) {
        throw new Error(`关联表缺少可用视图：${tableId}`);
      }
      const orderedFields = await linkedView.getFieldMetaList();
      const fieldCache = new Map<string, ReturnType<typeof linkedTable.getFieldById>>();
      const recordCache = new Map<string, ReturnType<typeof linkedTable.getRecordById>>();
      return {
        async getOrderedFields() {
          return orderedFields.map((field) => ({ id: field.id, name: field.name }));
        },
        async getCellText(linkedRecordId, fieldId) {
          let linkedRecord = recordCache.get(linkedRecordId);
          if (!linkedRecord) {
            linkedRecord = linkedTable.getRecordById(linkedRecordId);
            recordCache.set(linkedRecordId, linkedRecord);
          }
          if (!await linkedRecord) throw new Error(`关联记录不存在：${linkedRecordId}`);
          const fieldName = orderedFields.find((field) => field.id === fieldId)?.name ?? fieldId;
          try {
            let linkedField = fieldCache.get(fieldId);
            if (!linkedField) {
              linkedField = linkedTable.getFieldById(fieldId);
              fieldCache.set(fieldId, linkedField);
            }
            return await (await linkedField).getCellString(linkedRecordId);
          } catch (error) {
            return unreadableFieldValue(fieldName, error);
          }
        },
      };
    })();
    linkedReaders.set(tableId, pending);
    return pending;
  };

  const records = await Promise.all(recordIds.map(async (recordId) => {
    const record = await (table.getRecordById as unknown as (id: string, refreshLinkValue?: boolean) => Promise<unknown>)(recordId, true) as {
      fields: Record<string, unknown>;
    };
    const entries = await Promise.all(meta.map(async (field) => {
      if (!isLinkField(field)) {
        return [field.name, await getCellString(recordId, field)] as const;
      }
      const linkValue = toLinkCellValue(record.fields[field.id], field);
      const expanded = await expandLinkedRecords(linkValue, await getLinkedReader(linkValue.tableId));
      linkedColumns.set(field.id, expanded.columns);
      return [field.name, expanded.rows] as const;
    }));
    return {
      recordId,
      values: Object.fromEntries(entries),
    };
  }));
  const fields: NormalizedField[] = meta.map((field) => ({
    id: field.id,
    name: field.name,
    type: String(field.type),
    ...(isLinkField(field) ? {
      isLink: true,
      arrayColumns: linkedColumns.get(field.id) ?? [],
    } : {}),
  }));
  return buildPrintJob({
    source: { baseId: selection.baseId, tableId: selection.tableId },
    table: { name, fields },
    selectedIds: recordIds,
    records,
    generatedAt: new Date().toISOString(),
  });
}
