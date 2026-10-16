import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAutomationRenderRequest,
  createAutomationFailureResult,
  createAutomationSuccessResult,
  type AutomationJobInput,
} from "../src/automation/automation-domain.ts";

function input(overrides: Partial<AutomationJobInput> = {}): AutomationJobInput {
  return {
    context: {
      tenantKey: "tenant-a",
      baseToken: "base-a",
      tableId: "table-a",
      recordId: "record-a",
    },
    template: {
      id: "template-a",
      name: "发货单",
      revision: "revision-1",
      baseToken: "base-a",
      tableId: "table-a",
      snapshot: {
        canvasSize: { width: 794, height: 1123 },
        pages: [{ elements: [{ type: "text", text: "@订单编号" }] }],
      },
    },
    outputType: "pdf",
    referencedFieldIds: ["field-order", "field-customer"],
    recordValues: {
      "field-order": "PO-001",
      "field-customer": "客户甲",
      "field-private": "不得发送",
    },
    ...overrides,
  };
}

test("UT-AUTO-01: one record and one same-scope template form an automation job", async () => {
  const result = await buildAutomationRenderRequest(input());
  assert.match(result.artifactKey, /^duowei:v1:[a-f0-9]{64}$/);
  assert.equal(result.output.type, "pdf");
  assert.equal(result.output.pageLimit, null);
});

test("UT-AUTO-01: missing trigger record and cross-table templates are rejected", async () => {
  await assert.rejects(
    buildAutomationRenderRequest(input({
      context: { tenantKey: "tenant-a", baseToken: "base-a", tableId: "table-a", recordId: null },
    })),
    /当前记录/,
  );
  await assert.rejects(
    buildAutomationRenderRequest(input({
      template: {
        ...input().template,
        tableId: "table-b",
      },
    })),
    /当前数据表/,
  );
});

test("UT-AUTO-02: artifact keys are stable and change with business inputs", async () => {
  const first = await buildAutomationRenderRequest(input());
  const repeated = await buildAutomationRenderRequest(input());
  const changedValue = await buildAutomationRenderRequest(input({
    recordValues: {
      ...input().recordValues,
      "field-order": "PO-002",
    },
  }));
  const changedRevision = await buildAutomationRenderRequest(input({
    template: {
      ...input().template,
      revision: "revision-2",
    },
  }));
  const changedOutput = await buildAutomationRenderRequest(input({ outputType: "png" }));

  assert.equal(first.artifactKey, repeated.artifactKey);
  assert.notEqual(first.artifactKey, changedValue.artifactKey);
  assert.notEqual(first.artifactKey, changedRevision.artifactKey);
  assert.notEqual(first.artifactKey, changedOutput.artifactKey);
});

test("UT-AUTO-03: renderer payload contains only referenced values and no Feishu credentials", async () => {
  const result = await buildAutomationRenderRequest(input());
  assert.deepEqual(result.values, {
    "field-order": "PO-001",
    "field-customer": "客户甲",
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /tenant-a|base-a|table-a|record-a|field-private|tenantAccessToken/i);

  await assert.rejects(
    buildAutomationRenderRequest(input({
      template: {
        ...input().template,
        snapshot: {
          canvasSize: { width: 794, height: 1123 },
          pages: [],
          authorization: "Bearer secret",
        },
      },
    })),
    /敏感凭据/,
  );
});

test("UT-AUTO-03: PNG is explicitly first-page-only", async () => {
  const result = await buildAutomationRenderRequest(input({ outputType: "png" }));
  assert.deepEqual(result.output, { type: "png", pageLimit: 1 });
});

test("UT-AUTO-04: automation results have a stable downstream shape", () => {
  assert.deepEqual(
    createAutomationSuccessResult("duowei:v1:key", [{ token: "attachment" }]),
    {
      success: true,
      status: "生成成功",
      error: "",
      artifactKey: "duowei:v1:key",
      attachments: [{ token: "attachment" }],
    },
  );

  const failed = createAutomationFailureResult(
    "duowei:v1:key",
    "Bearer abcdef1234567890 tenant_access_token=secret",
  );
  assert.equal(failed.success, false);
  assert.equal(failed.status, "生成失败");
  assert.doesNotMatch(failed.error, /abcdef|secret/);
  assert.deepEqual(failed.attachments, []);
});
