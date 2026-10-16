import assert from "node:assert/strict";
import test from "node:test";
import {
  createAutomationAction,
  type AutomationActionDependencies,
  type AutomationActionExecution,
} from "../src/automation/automation-action.ts";
import type { RegisteredAutomationTemplate } from "../src/automation/template-registry.ts";

const pdfBytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n%%EOF");

function template(overrides: Partial<RegisteredAutomationTemplate> = {}): RegisteredAutomationTemplate {
  return {
    tenantKey: "tenant-a",
    baseToken: "base-a",
    tableId: "table-a",
    id: "template-a",
    name: "发货单",
    revision: "revision-1",
    status: "ready",
    snapshot: { pages: [{ elements: [{ fieldId: "field-a" }] }] },
    referencedFieldIds: ["field-a"],
    ...overrides,
  };
}

function execution(overrides: Partial<AutomationActionExecution> = {}): AutomationActionExecution {
  return {
    context: {
      tenantKey: "tenant-a",
      baseToken: "base-a",
      tableId: "table-a",
      recordId: "record-a",
      tenantAccessToken: "tenant_access_token_secret",
    },
    templateSelection: { id: "template-a", revision: "revision-1" },
    outputType: "pdf",
    ...overrides,
  };
}

function dependencies(overrides: Partial<AutomationActionDependencies> = {}): AutomationActionDependencies {
  return {
    templateRegistry: {
      async getTemplate() {
        return template();
      },
    },
    recordReader: {
      async readRecord(request) {
        return Object.fromEntries(request.fieldIds.map((fieldId) => [fieldId, `${fieldId}-value`]));
      },
    },
    renderer: {
      async render(request) {
        return {
          artifactKey: request.artifactKey,
          fileName: "发货单.pdf",
          contentType: "application/pdf",
          pageCount: 2,
          bytes: pdfBytes,
        };
      },
    },
    attachmentUploader: {
      async upload(request) {
        return [{ name: request.fileName, token: "attachment-a" }];
      },
    },
    ...overrides,
  };
}

test("IT-AUTO-01/04/06: action reads only referenced fields and returns an uploaded attachment", async () => {
  let readRequest: unknown;
  let renderRequest: unknown;
  let uploadToken = "";
  const deps = dependencies({
    recordReader: {
      async readRecord(request) {
        readRequest = request;
        return { "field-a": "SO-001", "field-not-requested": "不得外发" };
      },
    },
    renderer: {
      async render(request) {
        renderRequest = request;
        return {
          artifactKey: request.artifactKey,
          fileName: "发货单.pdf",
          contentType: "application/pdf",
          pageCount: 2,
          bytes: pdfBytes,
        };
      },
    },
    attachmentUploader: {
      async upload(request) {
        uploadToken = request.tenantAccessToken;
        return [{ name: request.fileName, token: "attachment-a" }];
      },
    },
  });

  const result = await createAutomationAction(deps).execute(execution());
  assert.equal(result.success, true);
  assert.equal(result.status, "生成成功");
  assert.deepEqual(result.attachments, [{ name: "发货单.pdf", token: "attachment-a" }]);
  assert.deepEqual(readRequest, {
    baseToken: "base-a",
    tableId: "table-a",
    recordId: "record-a",
    fieldIds: ["field-a"],
    tenantAccessToken: "tenant_access_token_secret",
  });
  assert.equal(uploadToken, "tenant_access_token_secret");
  assert.deepEqual((renderRequest as { values: unknown }).values, { "field-a": "SO-001" });
  assert.equal(JSON.stringify(renderRequest).includes("tenant_access_token_secret"), false);
  assert.equal(JSON.stringify(renderRequest).includes("field-not-requested"), false);
});

test("IT-AUTO-01/05: concurrent duplicate deliveries render and upload once", async () => {
  let renders = 0;
  let uploads = 0;
  const deps = dependencies({
    renderer: {
      async render(request) {
        renders += 1;
        await Promise.resolve();
        return {
          artifactKey: request.artifactKey,
          fileName: "发货单.pdf",
          contentType: "application/pdf",
          pageCount: 1,
          bytes: pdfBytes,
        };
      },
    },
    attachmentUploader: {
      async upload() {
        uploads += 1;
        return [{ token: "attachment-a" }];
      },
    },
  });
  const action = createAutomationAction(deps);
  const [first, second] = await Promise.all([action.execute(execution()), action.execute(execution())]);
  assert.equal(first.artifactKey, second.artifactKey);
  assert.equal(renders, 1);
  assert.equal(uploads, 1);
});

test("IT-AUTO-02/08: invalid or failed renders never upload and remain retryable", async () => {
  let renders = 0;
  let uploads = 0;
  const deps = dependencies({
    renderer: {
      async render(request) {
        renders += 1;
        if (renders === 1) throw new Error("Bearer abc.secret renderer unavailable");
        return {
          artifactKey: request.artifactKey,
          fileName: "发货单.pdf",
          contentType: "image/png",
          pageCount: 1,
          bytes: pdfBytes,
        };
      },
    },
    attachmentUploader: {
      async upload() {
        uploads += 1;
        return [];
      },
    },
  });
  const action = createAutomationAction(deps);
  const failed = await action.execute(execution());
  assert.equal(failed.success, false);
  assert.match(failed.error, /renderer unavailable/);
  assert.doesNotMatch(failed.error, /abc\.secret/);
  const invalid = await action.execute(execution());
  assert.equal(invalid.success, false);
  assert.match(invalid.error, /PDF/);
  assert.equal(renders, 2);
  assert.equal(uploads, 0);
});

test("CT-AUTO-01: missing, stale, or cross-scope templates are rejected before data access", async () => {
  for (const candidate of [
    null,
    template({ revision: "revision-2" }),
    template({ tenantKey: "tenant-b" }),
    template({ baseToken: "base-b" }),
    template({ tableId: "table-b" }),
    template({ status: "syncing" }),
  ]) {
    let reads = 0;
    const deps = dependencies({
      templateRegistry: { async getTemplate() { return candidate; } },
      recordReader: { async readRecord() { reads += 1; return {}; } },
    });
    await assert.rejects(createAutomationAction(deps).execute(execution()), /模板/);
    assert.equal(reads, 0);
  }
});
