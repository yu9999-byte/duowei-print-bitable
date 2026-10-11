export type LinkCellValue = {
  tableId: string;
  recordIds: string[];
  text: string;
};

export type LinkedField = {
  id: string;
  name: string;
};

export type LinkedTableReader = {
  getOrderedFields(): Promise<LinkedField[]>;
  getCellText(recordId: string, fieldId: string): Promise<string>;
};

export type ExpandedLinkedRecords = {
  columns: Array<{ field: string; header: string }>;
  rows: Array<Record<string, string>>;
};

export function duplicateLinkedRecordId(recordIds: readonly string[]): string | undefined {
  const seenRecordIds = new Set<string>();
  for (const recordId of recordIds) {
    if (seenRecordIds.has(recordId)) return recordId;
    seenRecordIds.add(recordId);
  }
  return undefined;
}

export async function expandLinkedRecords(
  value: LinkCellValue,
  reader: LinkedTableReader,
): Promise<ExpandedLinkedRecords> {
  const duplicateId = duplicateLinkedRecordId(value.recordIds);
  if (duplicateId) throw new Error(`关联字段包含重复记录 ID：${duplicateId}`);
  const fields = (await reader.getOrderedFields()).slice(0, 5);
  const columns = fields.map((field) => ({
    field: field.name,
    header: field.name,
  }));
  const rows = await Promise.all(value.recordIds.map(async (recordId) => {
    try {
      const entries = await Promise.all(fields.map(async (field) => [
        field.name,
        await reader.getCellText(recordId, field.id),
      ] as const));
      return Object.fromEntries(entries);
    } catch (error) {
      if (error instanceof Error && error.name === "BitableReadTimeoutError") throw error;
      throw new Error(`关联记录读取失败：${recordId}`);
    }
  }));

  return { columns, rows };
}
