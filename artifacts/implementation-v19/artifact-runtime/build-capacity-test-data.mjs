import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "A:/打印宝/outputs/01a0c1f0-84d3-7980-8c1f-f7c01735cb53";
const previewPath = "A:/打印宝/artifacts/implementation-v19/容量测试数据预览.png";
const outputPath = `${outputDir}/Goal-v19-独立测试Base-51条虚构数据.xlsx`;

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("容量样本");
sheet.showGridLines = false;

const headers = [
  "订单编号",
  "客户名称",
  "商品名称",
  "数量",
  "单价",
  "订单状态",
  "下单日期",
  "要求送达日期",
  "联系电话",
  "收货地址",
  "备注",
];

const statuses = ["待处理", "处理中", "已完成"];
const products = ["容量测试商品 A", "容量测试商品 B", "容量测试商品 C"];
const rows = Array.from({ length: 51 }, (_, index) => {
  const sequence = index + 1;
  const suffix = String(sequence).padStart(3, "0");
  const orderedAt = new Date(Date.UTC(2026, 9, 1 + index));
  const requiredAt = new Date(Date.UTC(2026, 9, 4 + index));
  return [
    `CAP-${suffix}`,
    `虚构测试客户 ${suffix}`,
    products[index % products.length],
    sequence,
    10 + sequence * 0.5,
    statuses[index % statuses.length],
    orderedAt,
    requiredAt,
    `1990000${String(sequence).padStart(4, "0")}`,
    `虚构测试地址 ${suffix} 号`,
    `Goal v19 容量验收样本 ${suffix}，仅用于独立测试 Base。`,
  ];
});

sheet.getRange("A1:K52").values = [headers, ...rows];
sheet.getRange("A1:K52").format.font = { name: "Arial", size: 10, color: "#1F2329" };
sheet.getRange("A1:K1").format = {
  fill: "#2B5FD9",
  font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: false,
  borders: { preset: "outside", style: "thin", color: "#244DAF" },
};
sheet.getRange("A2:K52").format.verticalAlignment = "center";
sheet.getRange("A2:C52").format.horizontalAlignment = "left";
sheet.getRange("D2:E52").format.horizontalAlignment = "right";
sheet.getRange("F2:K52").format.horizontalAlignment = "left";
sheet.getRange("D2:D52").format.numberFormat = "#,##0";
sheet.getRange("E2:E52").format.numberFormat = "#,##0.00";
sheet.getRange("G2:H52").format.numberFormat = "yyyy-mm-dd";
sheet.getRange("A2:C52").format.numberFormat = "@";
sheet.getRange("F2:F52").format.numberFormat = "@";
sheet.getRange("I2:K52").format.numberFormat = "@";
sheet.getRange("A1:K52").format.rowHeight = 22;
sheet.getRange("A1:A52").format.columnWidth = 14;
sheet.getRange("B1:B52").format.columnWidth = 20;
sheet.getRange("C1:C52").format.columnWidth = 20;
sheet.getRange("D1:D52").format.columnWidth = 10;
sheet.getRange("E1:E52").format.columnWidth = 12;
sheet.getRange("F1:F52").format.columnWidth = 12;
sheet.getRange("G1:H52").format.columnWidth = 15;
sheet.getRange("I1:I52").format.columnWidth = 16;
sheet.getRange("J1:J52").format.columnWidth = 24;
sheet.getRange("K1:K52").format.columnWidth = 44;
sheet.freezePanes.freezeRows(1);

const table = sheet.tables.add("A1:K52", true, "CapacitySampleTable");
table.style = "TableStyleMedium2";
table.showBandedColumns = false;
table.showFilterButton = true;

workbook.recalculate();

const dataCheck = await workbook.inspect({
  kind: "table",
  range: "容量样本!A1:K52",
  include: "values,formulas",
  tableMaxRows: 55,
  tableMaxCols: 12,
  maxChars: 20000,
});
const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 100 },
  summary: "Goal v19 test data final formula error scan",
});

const preview = await workbook.render({
  sheetName: "容量样本",
  range: "A1:K18",
  scale: 1,
  format: "png",
});

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

const reopened = await SpreadsheetFile.importXlsx(await FileBlob.load(outputPath));
const reopenedSheet = reopened.worksheets.getItem("容量样本");
const reopenedValues = reopenedSheet.getRange("A1:K52").values;
const ids = reopenedValues.slice(1).map((row) => row[0]);

if (reopenedValues.length !== 52 || ids.length !== 51) {
  throw new Error(`Expected 51 data rows, got ${ids.length}.`);
}
if (ids[0] !== "CAP-001" || ids[24] !== "CAP-025" || ids[49] !== "CAP-050" || ids[50] !== "CAP-051") {
  throw new Error(`Unexpected boundary IDs: ${ids[0]}, ${ids[24]}, ${ids[49]}, ${ids[50]}.`);
}
if (new Set(ids).size !== 51) {
  throw new Error("Capacity sample contains duplicate order IDs.");
}

const reopenedCheck = await reopened.inspect({
  kind: "table",
  range: "容量样本!A1:K52",
  include: "values,formulas",
  tableMaxRows: 4,
  tableMaxCols: 12,
  maxChars: 6000,
});

console.log(JSON.stringify({
  outputPath,
  previewPath,
  rowCount: ids.length,
  firstId: ids[0],
  middleId: ids[24],
  fiftiethId: ids[49],
  overflowId: ids[50],
  uniqueIdCount: new Set(ids).size,
  formulaErrors: formulaErrors.ndjson,
  initialInspect: dataCheck.ndjson.slice(0, 1000),
  reopenedInspect: reopenedCheck.ndjson,
}, null, 2));
