import assert from "node:assert/strict";
import test from "node:test";
import { Component, NextStep, StructureType, type Context } from "@lark-opdev/block-basekit-server-api";
import {
  createFeishuAutomationActionDefinition,
  type FeishuAutomationAdapters,
} from "../src/automation/feishu-action-definition.ts";
import type { RegisteredAutomationTemplate } from "../src/automation/template-registry.ts";

const pdfBytes = new TextEncoder().encode("%PDF-1.4\n%%EOF");

function template(overrides: Partial<RegisteredAutomationTemplate> = {}): RegisteredAutomationTemplate {
  return {
    tenantKey: "tenant-a",
    baseToken: "base-a",
    tableId: "table-a",
    id: "template-a",
    name: "发货单",
    revision: "revision-1",
    status: "ready",
    snapshot: { pages: [] },
    referencedFieldIds: ["field-a"],
    ...overrides,
  };
}

function context(): Context {
  return {
    app: {
      logID: "log-a",
      token: "base-a",
      timeZone: "Asia/Shanghai",
      url: "https://example.feishu.cn/base/base-a",
      trigger: { type: "ButtonTrigger" as never, tableID: "table-a", recordID: "record-a" },
    },
    packID: "pack-a",
    extensionID: "extension-a",
    tenantKey: "tenant-a",
    tenantAccessToken: "tenant_access_token_secret",
    fetch: globalThis.fetch,
  };
}

function adapters(overrides: Partial<FeishuAutomationAdapters> = {}): FeishuAutomationAdapters {
  return {
    templates: {
      async list() { return [template()]; },
      async get() { return template(); },
    },
    recordReader: {
      async readRecord(_context, request) {
        return Object.fromEntries(request.fieldIds.map((fieldId) => [fieldId, "SO-001"]));
      },
    },
    renderer: {
      async render(_context, request) {
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
      async upload() { return [{ attachmentToken: "attachment-a" }]; },
    },
    fields: {
      async list() {
        return [
          { id: "attachment-a", name: "生成文件", type: "attachment" },
          { id: "status-a", name: "生成状态", type: "text" },
          { id: "error-a", name: "错误信息", type: "text" },
        ];
      },
    },
    backgroundJobs: {
      async submit(_context, request) {
        return { jobId: request.taskKey, status: "queued", reused: false };
      },
    },
    ...overrides,
  };
}

test("CT-AUTO-02/08: Feishu action exposes template, output, standard/background mode, and typed background fields", () => {
  const definition = createFeishuAutomationActionDefinition(adapters());
  assert.equal(definition.permission?.type, 2);
  assert.equal(definition.useTenantAccessToken, true);
  assert.deepEqual(definition.nextSteps, [NextStep.SetRecord]);
  assert.equal(definition.formItems.length, 7);
  assert.deepEqual(definition.formItems.map((item) => item.component), [
    Component.SingleSelect,
    Component.Radio,
    Component.Radio,
    Component.SingleSelect,
    Component.SingleSelect,
    Component.SingleSelect,
    Component.Tips,
  ]);
  assert.equal(definition.formItems.find((item) => item.itemId === "attachmentField")?.displayBy, "runMode:background");
  assert.equal(definition.formItems.find((item) => item.itemId === "statusField")?.displayBy, "runMode:background");
  assert.equal(definition.formItems.find((item) => item.itemId === "errorField")?.displayBy, "runMode:background");
  assert.match(JSON.stringify(definition.formItems), /PNG 仅生成第一页/);
  assert.match(JSON.stringify(definition.formItems), /标准模式/);
  assert.match(JSON.stringify(definition.formItems), /后台模式/);
  assert.equal(definition.resultType.properties.attachments.structureType, StructureType.Attachment);
  assert.deepEqual(Object.keys(definition.resultType.properties), [
    "attachments",
    "success",
    "status",
    "error",
    "artifactKey",
  ]);
});

test("CT-AUTO-08: background field selectors return only attachment or text fields", async () => {
  const definition = createFeishuAutomationActionDefinition(adapters({
    fields: {
      async list() {
        return [
          { id: "attachment-a", name: "生成文件", type: "attachment" },
          { id: "status-a", name: "生成状态", type: "text" },
          { id: "number-a", name: "数量", type: "other" },
        ];
      },
    },
  }));
  const select = async (itemId: string) => {
    const item = definition.formItems.find((candidate) => candidate.itemId === itemId);
    if (item?.component !== Component.SingleSelect || !item.autocomplete) throw new Error(`${itemId} autocomplete missing`);
    return item.autocomplete({ runMode: "background" }, context(), {
      itemId,
      nextPageRequestData: null,
      keyword: "",
      lang: "zh-CN",
    });
  };
  assert.deepEqual((await select("attachmentField")).options, [{ value: "attachment-a", label: "生成文件" }]);
  assert.deepEqual((await select("statusField")).options, [{ value: "status-a", label: "生成状态" }]);
  assert.deepEqual((await select("errorField")).options, [{ value: "status-a", label: "生成状态" }]);
});

test("CT-AUTO-01/02: autocomplete returns only ready current-scope names and opaque values", async () => {
  const definition = createFeishuAutomationActionDefinition(adapters({
    templates: {
      async list() {
        return [
          template(),
          template({ id: "other", name: "采购单" }),
          template({ id: "draft", name: "草稿", status: "syncing" }),
          template({ id: "foreign", tenantKey: "tenant-b", name: "其他租户" }),
        ];
      },
      async get() { return template(); },
    },
  }));
  const item = definition.formItems[0];
  assert.equal(item.component, Component.SingleSelect);
  if (item.component !== Component.SingleSelect || !item.autocomplete) throw new Error("template autocomplete missing");
  const result = await item.autocomplete({}, context(), {
    itemId: "template",
    nextPageRequestData: null,
    keyword: "发货",
    lang: "zh-CN",
  });
  assert.deepEqual(result.options.map((option) => option.label), ["发货单"]);
  assert.equal(result.options[0].value.includes("template-a"), true);
  assert.equal(JSON.stringify(result).includes("pages"), false);
});

test("CT-AUTO-01: autocomplete exposes a sanitized diagnostic instead of silently showing no templates", async () => {
  const definition = createFeishuAutomationActionDefinition(adapters({
    templates: {
      async list() {
        throw new Error("http action process failure: Bearer super-secret-token");
      },
      async get() { return template(); },
    },
  }));
  const item = definition.formItems[0];
  if (item.component !== Component.SingleSelect || !item.autocomplete) throw new Error("template autocomplete missing");
  const result = await item.autocomplete({}, context(), {
    itemId: "template",
    nextPageRequestData: null,
    keyword: "",
    lang: "zh-CN",
  });
  assert.equal(result.options.length, 1);
  assert.equal(result.options[0].value, "__duowei_template_read_error__");
  assert.match(String(result.options[0].label), /模板读取失败：http action process failure/);
  assert.doesNotMatch(JSON.stringify(result), /super-secret-token/);
});

test("IT-AUTO-04: execute maps Feishu trigger context to the domain action and returns stable outputs", async () => {
  let templateScope: unknown;
  let readContextToken = "";
  let renderPayload = "";
  const definition = createFeishuAutomationActionDefinition(adapters({
    templates: {
      async list() { return [template()]; },
      async get(_context, scope) { templateScope = scope; return template(); },
    },
    recordReader: {
      async readRecord(ctx) {
        readContextToken = ctx.tenantAccessToken;
        return { "field-a": "SO-001" };
      },
    },
    renderer: {
      async render(_context, request) {
        renderPayload = JSON.stringify(request);
        return {
          artifactKey: request.artifactKey,
          fileName: "发货单.pdf",
          contentType: "application/pdf",
          pageCount: 1,
          bytes: pdfBytes,
        };
      },
    },
  }));
  const item = definition.formItems[0];
  if (item.component !== Component.SingleSelect || !item.autocomplete) throw new Error("template autocomplete missing");
  const options = await item.autocomplete({}, context(), {
    itemId: "template",
    nextPageRequestData: null,
    keyword: "",
    lang: "zh-CN",
  });
  const result = await definition.execute({ template: options.options[0].value, outputType: "pdf", runMode: "standard" }, context());
  assert.deepEqual(templateScope, { tenantKey: "tenant-a", baseToken: "base-a", tableId: "table-a" });
  assert.equal(readContextToken, "tenant_access_token_secret");
  assert.equal(renderPayload.includes("tenant_access_token_secret"), false);
  assert.deepEqual(result, {
    success: true,
    status: "生成成功",
    error: "",
    artifactKey: (result as { artifactKey: string }).artifactKey,
    attachments: [{ attachmentToken: "attachment-a" }],
  });
});

test("IT-AUTO-10: background mode submits a durable task and returns no synchronous attachment", async () => {
  let submitted: unknown;
  const definition = createFeishuAutomationActionDefinition(adapters({
    backgroundJobs: {
      async submit(_context, request) {
        submitted = request;
        return { jobId: request.taskKey, status: "queued", reused: false };
      },
    },
  }));
  const templateItem = definition.formItems[0];
  if (templateItem.component !== Component.SingleSelect || !templateItem.autocomplete) throw new Error("template autocomplete missing");
  const options = await templateItem.autocomplete({}, context(), {
    itemId: "template", nextPageRequestData: null, keyword: "", lang: "zh-CN",
  });
  const result = await definition.execute({
    template: options.options[0].value,
    outputType: "png",
    runMode: "background",
    attachmentField: "attachment-a",
    statusField: "status-a",
    errorField: "error-a",
  }, context());
  assert.equal(JSON.stringify(submitted).includes("tenant_access_token_secret"), false);
  assert.deepEqual(result, {
    success: true,
    status: "等待生成",
    error: "",
    artifactKey: (submitted as { renderRequest: { artifactKey: string } }).renderRequest.artifactKey,
    attachments: [],
  });
});
