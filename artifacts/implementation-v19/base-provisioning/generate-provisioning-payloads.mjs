import fs from "node:fs/promises";

const baseToken = "GmpDbJRMiaBQSgsTnnncwdn1nCd";
const tableId = "tbllgFkpFtzSzDs4";
const primaryFieldId = "fldRo0gGIN";

const primaryField = {
  type: "text",
  name: "订单编号",
  description: "Goal v19 批量容量验收唯一编号",
  style: { type: "plain" },
};

const additionalFields = [
  { type: "text", name: "客户名称", style: { type: "plain" } },
  { type: "text", name: "商品名称", style: { type: "plain" } },
  {
    type: "number",
    name: "数量",
    style: { type: "plain", precision: 0, percentage: false, thousands_separator: false },
  },
  {
    type: "number",
    name: "单价",
    style: { type: "currency", precision: 2, currency_code: "CNY" },
  },
  {
    type: "select",
    name: "订单状态",
    multiple: false,
    options: [
      { name: "待处理", hue: "Blue", lightness: "Lighter" },
      { name: "处理中", hue: "Orange", lightness: "Lighter" },
      { name: "已完成", hue: "Green", lightness: "Lighter" },
    ],
  },
  { type: "datetime", name: "下单日期", style: { format: "yyyy-MM-dd" } },
  { type: "datetime", name: "要求送达日期", style: { format: "yyyy-MM-dd" } },
  { type: "text", name: "联系电话", style: { type: "phone" } },
  { type: "text", name: "收货地址", style: { type: "plain" } },
  { type: "text", name: "备注", style: { type: "plain" } },
];

const statuses = ["待处理", "处理中", "已完成"];
const products = ["容量测试商品 A", "容量测试商品 B", "容量测试商品 C"];
const isoDate = (dayOffset) => {
  const date = new Date(Date.UTC(2026, 9, 1 + dayOffset));
  return `${date.toISOString().slice(0, 10)} 00:00:00`;
};

const createRecords = Array.from({ length: 51 }, (_, index) => {
  const sequence = index + 1;
  const suffix = String(sequence).padStart(3, "0");
  return {
    订单编号: `CAP-${suffix}`,
    客户名称: `虚构测试客户 ${suffix}`,
    商品名称: products[index % products.length],
    数量: sequence,
    单价: 10 + sequence * 0.5,
    订单状态: [statuses[index % statuses.length]],
    下单日期: isoDate(index),
    要求送达日期: isoDate(index + 3),
    联系电话: `1990000${String(sequence).padStart(4, "0")}`,
    收货地址: `虚构测试地址 ${suffix} 号`,
    备注: `Goal v19 容量验收样本 ${suffix}，仅用于独立测试 Base。`,
  };
});

const ids = createRecords.map((record) => record.订单编号);
if (ids.length !== 51 || new Set(ids).size !== 51) {
  throw new Error("Expected exactly 51 unique capacity record IDs.");
}
if (ids[0] !== "CAP-001" || ids[24] !== "CAP-025" || ids[49] !== "CAP-050" || ids[50] !== "CAP-051") {
  throw new Error("Capacity boundary IDs do not match the Goal v19 contract.");
}

await fs.writeFile("field-update-primary.json", `${JSON.stringify(primaryField, null, 2)}\n`, "utf8");
await fs.writeFile("field-create-additional.json", `${JSON.stringify(additionalFields, null, 2)}\n`, "utf8");
await fs.writeFile(
  "record-batch-create-51.json",
  `${JSON.stringify({ create_records: createRecords }, null, 2)}\n`,
  "utf8",
);
await fs.writeFile(
  "provisioning-manifest.json",
  `${JSON.stringify({
    base_token: baseToken,
    table_id: tableId,
    primary_field_id: primaryFieldId,
    target_table_name: "批量容量验收",
    record_count: ids.length,
    unique_record_count: new Set(ids).size,
    boundary_ids: {
      first: ids[0],
      middle: ids[24],
      limit: ids[49],
      overflow: ids[50],
    },
    immutable_tables: ["tblKsW0leslbWB8J", "tblzBPYAmTBy6N7c", "tblO5vUmhA1ONOBI"],
  }, null, 2)}\n`,
  "utf8",
);

console.log(JSON.stringify({
  baseToken,
  tableId,
  primaryFieldId,
  recordCount: ids.length,
  uniqueRecordCount: new Set(ids).size,
  boundaries: [ids[0], ids[24], ids[49], ids[50]],
}, null, 2));
