import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeTemplateSelection,
  encodeTemplateSelection,
  listTemplateOptions,
  type RegisteredAutomationTemplate,
} from "../src/automation/template-registry.ts";

function registered(overrides: Partial<RegisteredAutomationTemplate> = {}): RegisteredAutomationTemplate {
  return {
    tenantKey: "tenant-a",
    baseToken: "base-a",
    tableId: "table-a",
    id: "template-a",
    name: "发货单",
    revision: "revision-1",
    status: "ready",
    snapshot: { canvasSize: { width: 1, height: 1 }, pages: [] },
    referencedFieldIds: ["field-a"],
    ...overrides,
  };
}

test("CT-AUTO-01: template options are isolated to the current tenant, Base, and table", () => {
  const options = listTemplateOptions(
    { tenantKey: "tenant-a", baseToken: "base-a", tableId: "table-a" },
    [
      registered(),
      registered({ id: "draft", name: "未同步", status: "syncing" }),
      registered({ id: "other-table", tableId: "table-b" }),
      registered({ id: "other-tenant", tenantKey: "tenant-b" }),
    ],
  );
  assert.deepEqual(options.map((item) => item.label), ["发货单"]);
  assert.deepEqual(decodeTemplateSelection(options[0].value), {
    id: "template-a",
    revision: "revision-1",
  });
});

test("CT-AUTO-01: template selection values round-trip without delimiter guessing", () => {
  const value = encodeTemplateSelection({ id: "模板:~@/一", revision: "rev:~@/二" });
  assert.deepEqual(decodeTemplateSelection(value), {
    id: "模板:~@/一",
    revision: "rev:~@/二",
  });
  assert.throws(() => decodeTemplateSelection("template-a"), /模板选项/);
});
