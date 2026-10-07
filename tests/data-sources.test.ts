import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  buildDataSourceCatalog,
  buildDataSourceClipboardPayload,
  fieldDataSourceId,
  getDocumentVariables,
  insertDataSourceToken,
  parseDataSourceClipboardPayload,
  prepareTemplateForOutput,
  refreshTemplateDataSources,
  resolveDataSourceTokens,
  SYSTEM_PRINT_DATE_ID,
} from "../src/core/data-sources.ts";
import type { NormalizedField, PrintJob } from "../src/core/print-job.ts";

function dateJob(generatedAt: string): PrintJob {
  return {
    source: { baseId: "base", tableId: "table", recordIds: ["first", "second"] },
    table: { name: "orders", fields: [{ id: "order", name: "order", type: "1" }] },
    documents: [
      { recordId: "first", values: { order: "PO-0001" } },
      { recordId: "second", values: { order: "PO-0002" } },
    ],
    generatedAt,
  };
}

// Isolate TZ so concurrent tests and the user's system timezone are untouched.
function variablesInTimezone(job: PrintJob, timezone: string): Record<string, unknown>[] {
  const moduleUrl = new URL("../src/core/data-sources.ts", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { readFileSync } from "node:fs";
    import { getDocumentVariables } from ${JSON.stringify(moduleUrl)};
    const job = JSON.parse(readFileSync(0, "utf8"));
    const original = structuredClone(job);
    const variables = job.documents.map((_, index) => getDocumentVariables(job, index));
    assert.deepEqual(job, original);
    console.log(JSON.stringify(variables));
  `], {
    input: JSON.stringify(job),
    env: { ...process.env, TZ: timezone },
    encoding: "utf8",
    timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("UT-SRC-08/SPEC-SRC-02: print date uses the local day east of UTC at midnight", () => {
  const variables = variablesInTimezone(dateJob("2026-10-03T18:05:03.000Z"), "Asia/Shanghai");
  assert.equal(variables[0][SYSTEM_PRINT_DATE_ID], "2026-10-04");
  assert.equal(variables[0].打印日期, "2026-10-04");
});

test("UT-SRC-08/SPEC-SRC-02: print date uses the previous local day west of UTC", () => {
  const variables = variablesInTimezone(dateJob("2026-10-04T02:05:03.000Z"), "America/Los_Angeles");
  assert.equal(variables[0][SYSTEM_PRINT_DATE_ID], "2026-10-03");
  assert.equal(variables[0].打印日期, "2026-10-03");
});

test("UT-SRC-08/SPEC-SRC-02: UTC keeps the task's original day", () => {
  const variables = variablesInTimezone(dateJob("2026-10-03T18:05:03.000Z"), "UTC");
  assert.equal(variables[0][SYSTEM_PRINT_DATE_ID], "2026-10-03");
});

test("UT-SRC-08/SPEC-SRC-02: local calendar conversion follows daylight saving time", () => {
  const summer = variablesInTimezone(dateJob("2026-07-01T04:30:00.000Z"), "America/New_York");
  const winter = variablesInTimezone(dateJob("2026-01-01T04:30:00.000Z"), "America/New_York");
  assert.equal(summer[0][SYSTEM_PRINT_DATE_ID], "2026-07-01");
  assert.equal(winter[0][SYSTEM_PRINT_DATE_ID], "2025-12-31");
});

test("UT-SRC-08/SPEC-SRC-02: one batch timestamp keeps system date and business field separate", () => {
  const job = dateJob("2026-10-03T18:05:03.000Z");
  job.table.fields.push({ id: "business-date", name: "打印日期", type: "5" });
  job.documents[0].values.打印日期 = "2026-09-20";
  const variables = variablesInTimezone(job, "Asia/Shanghai");
  assert.deepEqual(variables.map((item) => item[SYSTEM_PRINT_DATE_ID]), ["2026-10-04", "2026-10-04"]);
  assert.equal(variables[0].打印日期, "2026-09-20");
  assert.equal(variables[0][fieldDataSourceId("business-date")], "2026-09-20");
  assert.equal(variables[1].打印日期, "2026-10-04");
  assert.equal(variables[0][fieldDataSourceId("order")], "PO-0001");
  assert.equal(variables[1][fieldDataSourceId("order")], "PO-0002");
});

test("UT-SRC-08/SPEC-SRC-02: invalid generation timestamps fail explicitly", () => {
  for (const generatedAt of ["", "not-a-date"]) {
    assert.throws(() => getDocumentVariables(dateJob(generatedAt), 0), /打印任务生成时间无效/);
  }
});

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
        { id: fieldDataSourceId("order-no"), label: "订单编号" },
        { id: fieldDataSourceId("customer"), label: "客户名称" },
        { id: fieldDataSourceId("lines"), label: "订单明细", isArray: true },
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
  assert.deepEqual(fieldIds, [fieldDataSourceId("asset"), fieldDataSourceId("owner")]);
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

test("SPEC-SRC-03: field, array, and system data sources copy stable tokens instead of drag payloads", () => {
  const customer = buildDataSourceClipboardPayload({ id: fieldDataSourceId("customer"), label: "客户名称" });
  assert.deepEqual(customer, {
    token: `@${fieldDataSourceId("customer")}`,
    text: "@客户名称",
    label: "客户名称",
    sourceId: fieldDataSourceId("customer"),
    mime: "application/x-duowei-data-source",
  });
  const lines = buildDataSourceClipboardPayload({
    id: fieldDataSourceId("lines"),
    label: "订单明细",
    isArray: true,
    columns: [{ field: "商品", header: "商品" }],
  });
  assert.equal(lines.token, `@${fieldDataSourceId("lines")}`);
  assert.equal(buildDataSourceClipboardPayload({ id: SYSTEM_PRINT_DATE_ID, label: "打印日期" }).token,
    `@${SYSTEM_PRINT_DATE_ID}`);
});

test("SPEC-SRC-05: copied tokens can be pasted repeatedly into one text component", () => {
  const customerToken = `@${fieldDataSourceId("customer")}`;
  const orderToken = `@${fieldDataSourceId("order-no")}`;
  const first = insertDataSourceToken("客户：", customerToken);
  const second = insertDataSourceToken(`${first.content}，订单号：`, orderToken);

  assert.equal(second.content, `客户：${customerToken}，订单号：${orderToken}`);
  assert.deepEqual(parseDataSourceClipboardPayload(
    "application/x-duowei-data-source",
    orderToken,
  ), { token: orderToken });
  assert.equal(resolveDataSourceTokens(second.content, {
    [fieldDataSourceId("customer")]: "甲公司",
    [fieldDataSourceId("order-no")]: "PO-0001",
  }), "客户：甲公司，订单号：PO-0001");
});

test("SPEC-SRC-05: token insertion respects a selected range and leaves unknown tokens intact", () => {
  const token = `@${fieldDataSourceId("customer")}`;
  const result = insertDataSourceToken("客户：待替换", token, { start: 3, end: 6 });

  assert.equal(result.content, `客户：${token}`);
  assert.deepEqual(result.selection, {
    start: 3 + token.length,
    end: 3 + token.length,
  });
  assert.equal(resolveDataSourceTokens(`值：${token} / @unknown`, {
    [fieldDataSourceId("customer")]: "甲公司",
  }), "值：甲公司 / @unknown");
});

test("SPEC-OUT-02: output preparation resolves multiple text tokens without mutating the editable template", () => {
  const customerToken = `@${fieldDataSourceId("customer")}`;
  const orderToken = `@${fieldDataSourceId("order-no")}`;
  const template = {
    pages: [{ id: "p", elements: [{
      id: "summary",
      type: "text",
      content: `客户：${customerToken}，订单号：${orderToken}`,
    }] }],
    canvasSize: { width: 794, height: 1123 },
  };
  const output = prepareTemplateForOutput(template, {
    [fieldDataSourceId("customer")]: "甲公司",
    [fieldDataSourceId("order-no")]: "PO-0001",
  });
  const element = (output.template.pages as any)[0].elements[0];

  assert.equal(element.content, "@__duowei_render_summary");
  assert.equal(element.variable, "@__duowei_render_summary");
  assert.equal(output.variables.__duowei_render_summary, "客户：甲公司，订单号：PO-0001");
  assert.equal((template.pages as any)[0].elements[0].content,
    `客户：${customerToken}，订单号：${orderToken}`);
});

test("SPEC-SRC-04: legacy name bindings migrate by unique name and field-ID bindings survive rename", () => {
  const old = {
    pages: [{ id: "p", elements: [{ type: "text", variable: "@客户名称", content: "客户：@客户名称" }] }],
    canvasSize: { width: 794, height: 1123 },
  };
  const migrated = refreshTemplateDataSources(old, fields);
  const element = (migrated.pages as any)[0].elements[0];
  assert.equal(element.variable, `@${fieldDataSourceId("customer")}`);
  assert.equal(element.content, `客户：@${fieldDataSourceId("customer")}`);
  const renamed = refreshTemplateDataSources(migrated, fields.map((field) => field.id === "customer"
    ? { ...field, name: "客户（新）" } : field));
  assert.equal((renamed.pages as any)[0].elements[0].variable, element.variable);
  assert.equal((renamed.ext as any).fieldBindings.customer, "客户（新）");
  assert.throws(() => refreshTemplateDataSources(old, fields.map((field) => field.id === "customer"
    ? { ...field, name: "已改名" } : field)), /无法识别旧字段绑定/);
});

test("SPEC-SRC-04: legacy names containing spaces migrate without parsing visible text", () => {
  const template = {
    pages: [{ id: "p", elements: [{ type: "text", variable: "@客户 名称", content: "客户：@客户 名称" }] }],
    canvasSize: { width: 794, height: 1123 },
  };
  const updated = refreshTemplateDataSources(template, [{ id: "customer", name: "客户 名称", type: "1" }]);
  assert.equal((updated.pages as any)[0].elements[0].content, `客户：@${fieldDataSourceId("customer")}`);
});

test("SPEC-SRC-04: ambiguous historical names never bind and deleted stable IDs are preserved", () => {
  const old = {
    pages: [{ id: "p", elements: [{ type: "text", variable: "@同名", content: "@同名" }] }],
    canvasSize: { width: 794, height: 1123 },
    ext: { fieldBindings: { first: "同名", second: "同名" } },
  };
  assert.throws(() => refreshTemplateDataSources(old, [
    { id: "first", name: "现在叫一", type: "1" },
    { id: "second", name: "现在叫二", type: "1" },
  ]), /无法识别旧字段绑定/);
  const deleted = {
    ...old,
    pages: [{ id: "p", elements: [{ type: "text", variable: `@${fieldDataSourceId("deleted")}` }] }],
  };
  const preserved = refreshTemplateDataSources(deleted, fields);
  assert.equal((preserved.pages as any)[0].elements[0].variable,
    `@${fieldDataSourceId("deleted")}`);
  assert.equal((preserved.ext as any).fieldBindings.first, "同名");
});

test("SPEC-SRC-05: content-only tokens are validated against current field IDs", () => {
  const contentOnly = {
    pages: [{ id: "p", elements: [{
      type: "text",
      content: `客户：@${fieldDataSourceId("customer")} / 订单：@${fieldDataSourceId("order-no")}`,
    }] }],
    canvasSize: { width: 794, height: 1123 },
  };
  const refreshed = refreshTemplateDataSources(contentOnly, fields);
  assert.equal((refreshed.pages as any)[0].elements[0].content, contentOnly.pages[0].elements[0].content);
  const missing = refreshTemplateDataSources(contentOnly, fields.filter((field) => field.id !== "order-no"));
  assert.equal((missing.pages as any)[0].elements[0].content, contentOnly.pages[0].elements[0].content);
});
