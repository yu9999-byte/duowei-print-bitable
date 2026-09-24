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

export async function expandLinkedRecords(
  value: LinkCellValue,
  reader: LinkedTableReader,
): Promise<ExpandedLinkedRecords> {
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
    } catch {
      throw new Error(`关联记录读取失败：${recordId}`);
    }
  }));

  return { columns, rows };
}
