import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDataSourceCatalog,
  buildDataSourceDragPayload,
  refreshTemplateDataSources,
  SYSTEM_PRINT_DATE_ID,
} from "../src/core/data-sources.ts";
import type { NormalizedField } from "../src/core/print-job.ts";

const fields: NormalizedField[] = [
  { id: "order-no", name: "订单编号", type: "1005" },
  { id: "customer", name: "客户名称", type: "1" },
  {
    id: "lines",
    name: "订单明细",
    type: "18",
    isLink: true,
    arrayColumns: [{ field: "商品", header: "商品" }],
  },
];

test("SPEC-SRC-01/02: current Base fields and system values form two data-source groups", () => {
  assert.deepEqual(buildDataSourceCatalog(fields), [
    {
      id: "__duowei_fields",
      label: "字段",
      children: [
        { id: "订单编号", label: "订单编号" },
        { id: "客户名称", label: "客户名称" },
        { id: "订单明细", label: "订单明细", isArray: true },
      ],
    },
    {
      id: "__duowei_system",
      label: "系统",
      children: [{ id: SYSTEM_PRINT_DATE_ID, label: "打印日期" }],
    },
  ]);
});

test("SPEC-SRC-01: data sources contain only the fields supplied by the current Base", () => {
  const catalog = buildDataSourceCatalog([
    { id: "asset", name: "资产名称", type: "1" },
    { id: "owner", name: "保管人", type: "11" },
  ]);
  const fieldIds = catalog[0].children.map((item) => item.id);
  assert.deepEqual(fieldIds, ["资产名称", "保管人"]);
  assert.ok(!fieldIds.includes("订单编号"));
  assert.ok(!fieldIds.includes("客户名称"));
});

test("SPEC-SRC-02: a stored template keeps layout but receives the current data-source catalog", () => {
  const stored = {
    pages: [{ id: "page-1", elements: [{ id: "title", type: "text", content: "保留排版" }] }],
    canvasSize: { width: 794, height: 1123 },
    ext: {
      theme: "saved-theme",
      availableVariables: [{ id: "demoCustomer", label: "假客户" }],
    },
  };

  const refreshed = refreshTemplateDataSources(stored, fields);
  assert.notEqual(refreshed, stored);
  assert.deepEqual(refreshed.pages, stored.pages);
  assert.equal(refreshed.ext.theme, "saved-theme");
  assert.deepEqual(refreshed.ext.availableVariables, buildDataSourceCatalog(fields));
  assert.deepEqual(stored.ext.availableVariables, [{ id: "demoCustomer", label: "假客户" }]);
});

test("SPEC-SRC-03: field and array data sources produce the real designer drag payload", () => {
  assert.deepEqual(buildDataSourceDragPayload({ id: "客户名称", label: "客户名称" }), {
    type: "text",
    variable: "客户名称",
  });
  assert.deepEqual(buildDataSourceDragPayload({
    id: "订单明细",
    label: "订单明细",
    isArray: true,
  }), {
    type: "table",
    dataVariable: "订单明细",
  });
});
