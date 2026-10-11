import { bitable, FieldType, type IFieldMeta, type IOpenLink } from "@lark-base-open/js-sdk";
import {
  duplicateLinkedRecordId,
  expandLinkedRecords,
  type LinkCellValue,
  type LinkedTableReader,
} from "../core/linked-records.ts";
import type { NormalizedField } from "../core/print-job.ts";
import { buildPrintJob, type PrintJob } from "../core/print-job.ts";
import type { FeishuSelection } from "./feishu-context.ts";
import {
  BitableReadTimeoutError,
  DEFAULT_READ_TIMEOUT_MS,
  withReadTimeout,
} from "./read-timeout.ts";

export { BitableReadTimeoutError, DEFAULT_READ_TIMEOUT_MS } from "./read-timeout.ts";

export type LoadPrintJobOptions = {
  timeoutMs?: number;
};

function unreadableFieldValue(fieldName: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const reason = message.replace(/\s+/g, " ").trim().slice(0, 120) || "未知原因";
  return `【字段不可读取：${fieldName}（${reason}）】`;
}

function isLinkField(field: IFieldMeta): boolean {
  return field.type === FieldType.SingleLink || field.type === FieldType.DuplexLink;
}

function getLinkKind(field: IFieldMeta, sourceTableId: string): "reference" | "detail" {
  const property = "property" in field && field.property && typeof field.property === "object"
    ? field.property as { tableId?: string; multiple?: boolean }
    : undefined;
  if (field.type === FieldType.SingleLink && property?.tableId === sourceTableId) {
    return "reference";
  }
  return property?.multiple === true ? "detail" : "reference";
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
  const duplicateId = duplicateLinkedRecordId(recordIds);
  if (duplicateId) {
    throw new Error(`关联字段包含重复记录 ID：${field.name}（${duplicateId}）`);
  }
  return {
    tableId,
    recordIds,
    text: typeof link?.text === "string" ? link.text : "",
  };
}

export async function loadPrintJob(
  selection: FeishuSelection,
  recordIds: string[],
  options: LoadPrintJobOptions = {},
): Promise<PrintJob> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
  const table = await withReadTimeout(
    "获取数据表",
    bitable.base.getTable(selection.tableId),
    timeoutMs,
  );
  const [meta, name] = await Promise.all([
    withReadTimeout("获取字段元数据", table.getFieldMetaList(), timeoutMs),
    withReadTimeout("获取数据表名称", table.getName(), timeoutMs),
  ]);
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
      return await withReadTimeout(
        `读取字段“${field.name}”`,
        (await withReadTimeout(`获取字段“${field.name}”`, readableField, timeoutMs)).getCellString(recordId),
        timeoutMs,
      );
    } catch (error) {
      if (error instanceof BitableReadTimeoutError) throw error;
      return unreadableFieldValue(field.name, error);
    }
  };

  const getLinkedReader = (tableId: string): Promise<LinkedTableReader> => {
    const cached = linkedReaders.get(tableId);
    if (cached) return cached;
    const pending = (async (): Promise<LinkedTableReader> => {
      const linkedTable = await withReadTimeout(
        "获取关联数据表",
        bitable.base.getTable(tableId),
        timeoutMs,
      );
      const linkedTableCompat = linkedTable as typeof linkedTable & {
        getViewList?: () => Promise<Array<{ getFieldMetaList: () => Promise<IFieldMeta[]> }>>;
      };
      const linkedView = linkedTableCompat.getViewList
        ? (await withReadTimeout("获取关联视图", linkedTableCompat.getViewList(), timeoutMs))[0]
        : await (async () => {
          const linkedViewMeta = (await withReadTimeout(
            "获取关联视图元数据",
            linkedTable.getViewMetaList(),
            timeoutMs,
          ))[0];
          return linkedViewMeta
            ? await withReadTimeout("获取关联视图", linkedTable.getViewById(linkedViewMeta.id), timeoutMs)
            : undefined;
        })();
      if (!linkedView) {
        throw new Error(`关联表缺少可用视图：${tableId}`);
      }
      const orderedFields = await withReadTimeout(
        "获取关联字段元数据",
        linkedView.getFieldMetaList(),
        timeoutMs,
      );
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
          if (!await withReadTimeout("读取关联记录", linkedRecord, timeoutMs)) {
            throw new Error(`关联记录不存在：${linkedRecordId}`);
          }
          const fieldName = orderedFields.find((field) => field.id === fieldId)?.name ?? fieldId;
          try {
            let linkedField = fieldCache.get(fieldId);
            if (!linkedField) {
              linkedField = linkedTable.getFieldById(fieldId);
              fieldCache.set(fieldId, linkedField);
            }
            return await withReadTimeout(
              `读取关联字段“${fieldName}”`,
              (await withReadTimeout(`获取关联字段“${fieldName}”`, linkedField, timeoutMs)).getCellString(linkedRecordId),
              timeoutMs,
            );
          } catch (error) {
            if (error instanceof BitableReadTimeoutError) throw error;
            return unreadableFieldValue(fieldName, error);
          }
        },
      };
    })();
    linkedReaders.set(tableId, pending);
    return pending;
  };

  const readRecord = async (recordId: string) => {
    const record = await withReadTimeout(
      "读取记录",
      (table.getRecordById as unknown as (id: string, refreshLinkValue?: boolean) => Promise<unknown>)(recordId, true),
      timeoutMs,
    ) as {
      fields: Record<string, unknown>;
    };
    const entries = await Promise.all(meta.map(async (field) => {
      if (!isLinkField(field)) {
        return [field.name, await getCellString(recordId, field)] as const;
      }
      if (getLinkKind(field, selection.tableId) === "reference") {
        const value = await getCellString(recordId, field);
        return [field.name, value.trim() ? value : "—"] as const;
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
  };

  const records: Awaited<ReturnType<typeof readRecord>>[] = new Array(recordIds.length);
  let nextIndex = 0;
  let failure: { reason: unknown } | undefined;
  const workers = Array.from({ length: Math.min(4, recordIds.length) }, async () => {
    while (!failure && nextIndex < recordIds.length) {
      const index = nextIndex++;
      try {
        records[index] = await readRecord(recordIds[index]);
      } catch (reason) {
        failure ??= { reason };
      }
    }
  });
  await Promise.all(workers);
  if (failure) throw failure.reason;

  const fields: NormalizedField[] = meta.map((field) => ({
    id: field.id,
    name: field.name,
    type: String(field.type),
    ...(typeof field.isPrimary === "boolean" ? { isPrimary: field.isPrimary } : {}),
    ...(isLinkField(field) ? (() => {
      const linkKind = getLinkKind(field, selection.tableId);
      return {
        isLink: true as const,
        linkKind,
        ...(linkKind === "detail" ? { arrayColumns: linkedColumns.get(field.id) ?? [] } : {}),
      };
    })() : {}),
  }));
  return buildPrintJob({
    source: { baseId: selection.baseId, tableId: selection.tableId },
    table: { name, fields },
    selectedIds: recordIds,
    records,
    generatedAt: new Date().toISOString(),
  });
}
