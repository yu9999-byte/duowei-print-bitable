import assert from "node:assert/strict";
import test from "node:test";
import type { Context } from "@lark-opdev/block-basekit-server-api";
import { createFeishuAutomationAdapters } from "../src/automation/feishu-action-adapters.ts";
import {
  createAuthenticatedTemplateRegistry,
  createTemplateRegistryHttpHandler,
  signRegistryWriteRequest,
} from "../src/automation/template-registry-service.ts";
import { createRendererHttpHandler } from "../src/automation/renderer-service.ts";

const secret = new TextEncoder().encode("feishu-adapter-test-secret-that-is-long-enough");
const now = 1_800_000_000_000;
const pdfBytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%%EOF");

function context(fetcher: Context["fetch"]): Context {
  return {
    app: {
      token: "base-a",
      logID: "log-a",
      timeZone: "Asia/Shanghai",
      url: "https://example.invalid/base-a",
      trigger: { type: "AddRecordTrigger" as never, tableID: "table-a", recordID: "record-a" },
    },
    packID: "pack-a",
    extensionID: "extension-a",
    tenantAccessToken: "tenant-access-token-secret",
    tenantKey: "tenant-a",
    fetch: fetcher,
  };
}

test("SPEC-AUTO-06: record adapter projects only referenced field ids with the token kept inside Feishu", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const adapters = createFeishuAutomationAdapters({
    serviceAuthorization: "Bearer service-api-key",
    registryEndpoint: "https://registry.example/v1/templates",
    registryReadSigningSecret: secret,
    rendererEndpoint: "https://renderer.example/v1/render",
    rendererSigningSecret: secret,
    now: () => now,
    async uploadAttachments() { return []; },
  });
  const ctx = context((async (url, init) => {
    requestUrl = String(url);
    requestInit = init as unknown as RequestInit;
    return new Response(JSON.stringify({
      code: 0,
      data: { records: [{ record_id: "record-a", fields: { "field-a": "SO-001" } }] },
    }), { status: 200, headers: { "content-type": "application/json" } }) as never;
  }) as Context["fetch"]);

  const result = await adapters.recordReader.readRecord(ctx, {
    baseToken: "base-a",
    tableId: "table-a",
    recordId: "record-a",
    fieldIds: ["field-a"],
  });
  assert.match(requestUrl, /\/open-apis\/base\/v3\/bases\/base-a\/tables\/table-a\/records\/batch_get$/);
  assert.equal(new Headers(requestInit?.headers).get("authorization"), "Bearer tenant-access-token-secret");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    record_id_list: ["record-a"],
    select_fields: ["field-a"],
  });
  assert.deepEqual(result, { "field-a": "SO-001" });
});

test("SPEC-AUTO-02/03/06: registry and renderer adapters use service signatures without leaking tenant token", async () => {
  const registry = createAuthenticatedTemplateRegistry({ signingSecret: secret, now: () => now });
  const writeBody = {
    scope: { tenantKey: "tenant-a", baseToken: "base-a", tableId: "table-a" },
    template: {
      id: "template-a",
      name: "发货单",
      revision: "revision-a",
      snapshot: { canvasSize: { width: 600, height: 800 }, pages: [] },
      referencedFieldIds: ["field-a"],
    },
  };
  await registry.upsert(writeBody, await signRegistryWriteRequest(writeBody, {
    principalId: "user-a", ...writeBody.scope, canWrite: true,
  }, secret, now));
  const registryHandler = createTemplateRegistryHttpHandler({
    registry,
    readSigningSecret: secret,
    now: () => now,
  });
  const rendererHandler = createRendererHttpHandler({
    signingSecret: secret,
    now: () => now,
    async render(request) {
      return {
        artifactKey: request.artifactKey,
        fileName: "发货单.pdf",
        contentType: "application/pdf",
        pageCount: 1,
        bytes: pdfBytes,
      };
    },
  });
  const requests: string[] = [];
  const authorizations: string[] = [];
  const ctx = context((async (url, init) => {
    requests.push(String(init?.body ?? ""));
    authorizations.push(new Headers(init?.headers).get("authorization") ?? "");
    const request = new Request(String(url), init as unknown as RequestInit);
    return (String(url).includes("registry.example")
      ? registryHandler(request)
      : rendererHandler(request)) as never;
  }) as Context["fetch"]);
  const adapters = createFeishuAutomationAdapters({
    serviceAuthorization: "Bearer service-api-key",
    registryEndpoint: "https://registry.example/v1/templates",
    registryReadSigningSecret: secret,
    rendererEndpoint: "https://renderer.example/v1/render",
    rendererSigningSecret: secret,
    now: () => now,
    async uploadAttachments() { return []; },
  });
  assert.equal((await adapters.templates.list(ctx, writeBody.scope))[0]?.name, "发货单");
  const rendered = await adapters.renderer.render(ctx, {
    artifactKey: "duowei:v1:artifact-a",
    template: { id: "template-a", revision: "revision-a", snapshot: writeBody.template.snapshot },
    values: { "field-a": "SO-001" },
    output: { type: "pdf", pageLimit: null },
  });
  assert.equal(rendered.fileName, "发货单.pdf");
  assert.equal(requests.some((body) => body.includes("tenant-access-token-secret")), false);
  assert.deepEqual(authorizations, ["Bearer service-api-key", "Bearer service-api-key"]);
});

test("SPEC-AUTO-04: attachment adapter gives the SDK exactly one generated file", async () => {
  let uploaded: unknown;
  const adapters = createFeishuAutomationAdapters({
    serviceAuthorization: "Bearer service-api-key",
    registryEndpoint: "https://registry.example/v1/templates",
    registryReadSigningSecret: secret,
    rendererEndpoint: "https://renderer.example/v1/render",
    rendererSigningSecret: secret,
    async uploadAttachments(attachments) {
      uploaded = attachments;
      return [{ attachmentToken: "file-a", name: "发货单.pdf" }];
    },
  });
  const ctx = context((async () => new Response()) as never);
  const result = await adapters.attachmentUploader.upload(ctx, {
    artifactKey: "duowei:v1:artifact-a",
    fileName: "发货单.pdf",
    contentType: "application/pdf",
    pageCount: 1,
    bytes: pdfBytes,
  });
  assert.deepEqual(result, [{ attachmentToken: "file-a", name: "发货单.pdf" }]);
  const file = (uploaded as Array<{ file: Uint8Array }>)[0]?.file;
  assert.equal(file.byteLength, pdfBytes.byteLength);
});

test("SPEC-AUTO-14: field adapter normalizes and paginates current-table field metadata", async () => {
  const urls: string[] = [];
  const adapters = createFeishuAutomationAdapters({
    serviceAuthorization: "Bearer service-api-key",
    registryEndpoint: "https://registry.example/v1/templates",
    registryReadSigningSecret: secret,
    rendererEndpoint: "https://renderer.example/v1/render",
    rendererSigningSecret: secret,
    backgroundJobEndpoint: "https://service.example/v1/background-jobs",
    backgroundJobSigningSecret: secret,
    async uploadAttachments() { return []; },
  });
  const ctx = context((async (url) => {
    urls.push(String(url));
    const second = String(url).includes("page_token=next-a");
    return Response.json({ code: 0, data: {
      has_more: !second,
      page_token: second ? "" : "next-a",
      items: second
        ? [{ id: "status-a", name: "生成状态", type: "text" }]
        : [{ id: "attachment-a", name: "生成文件", type: "attachment" }],
    } }) as never;
  }) as Context["fetch"]);
  assert.deepEqual(await adapters.fields.list(ctx, {
    tenantKey: "tenant-a", baseToken: "base-a", tableId: "table-a",
  }), [
    { id: "attachment-a", name: "生成文件", type: "attachment" },
    { id: "status-a", name: "生成状态", type: "text" },
  ]);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /\/open-apis\/base\/v3\/bases\/base-a\/tables\/table-a\/fields/);
});

test("IT-AUTO-10: background adapter sends the current token only in the transient HTTPS header", async () => {
  let tokenHeader = "";
  let serializedBody = "";
  const adapters = createFeishuAutomationAdapters({
    serviceAuthorization: "Bearer service-api-key",
    registryEndpoint: "https://registry.example/v1/templates",
    registryReadSigningSecret: secret,
    rendererEndpoint: "https://renderer.example/v1/render",
    rendererSigningSecret: secret,
    backgroundJobEndpoint: "https://service.example/v1/background-jobs",
    backgroundJobSigningSecret: secret,
    now: () => now,
    async uploadAttachments() { return []; },
  });
  const ctx = context((async (_url, init) => {
    tokenHeader = new Headers(init?.headers).get("x-duowei-tenant-access-token") ?? "";
    serializedBody = String(init?.body ?? "");
    return Response.json({ jobId: `duowei-job:v1:${"a".repeat(64)}`, status: "queued", reused: false });
  }) as Context["fetch"]);
  await adapters.backgroundJobs.submit(ctx, {
    version: 1,
    taskKey: `duowei-job:v1:${"a".repeat(64)}`,
    tenantKey: "tenant-a",
    baseToken: "base-a",
    tableId: "table-a",
    recordId: "record-a",
    outputType: "pdf",
    renderRequest: {
      artifactKey: "duowei:v1:artifact-a",
      template: { id: "template-a", revision: "r1", snapshot: { pages: [] } },
      values: {},
      output: { type: "pdf", pageLimit: null },
    },
    targets: { attachmentFieldId: "attachment-a", statusFieldId: "status-a" },
  });
  assert.equal(tokenHeader, "tenant-access-token-secret");
  assert.doesNotMatch(serializedBody, /tenant-access-token-secret/);
});
