import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createAppTicketEventHandler,
  createJsonFileAppTicketStore,
} from "../src/automation/feishu-app-ticket.ts";
import {
  createFeishuBackgroundPorts,
  createMarketplaceTokenProvider,
} from "../src/automation/feishu-background-ports.ts";
import {
  buildBackgroundJobSubmission,
  type BackgroundJob,
} from "../src/automation/background-job.ts";

test("IT-AUTO-10: verified app_ticket callback persists only the current application ticket", async () => {
  const directory = await mkdtemp(join(tmpdir(), "duowei-ticket-"));
  try {
    const store = createJsonFileAppTicketStore({ path: join(directory, "ticket.json") });
    const handler = createAppTicketEventHandler({
      appId: "cli-app",
      verificationToken: "verification-token",
      store,
      now: () => 1_800_000_000_000,
    });
    const challenge = await handler(new Request("https://service.example/v1/feishu/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "verification-token", challenge: "challenge-a", type: "url_verification" }),
    }));
    assert.deepEqual(await challenge.json(), { challenge: "challenge-a" });

    const event = await handler(new Request("https://service.example/v1/feishu/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "verification-token",
        type: "event_callback",
        event: { type: "app_ticket", app_id: "cli-app", app_ticket: "ticket-a" },
      }),
    }));
    assert.equal(event.status, 200);
    assert.equal((await store.get())?.ticket, "ticket-a");

    const denied = await handler(new Request("https://service.example/v1/feishu/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "wrong", event: { type: "app_ticket", app_id: "cli-app", app_ticket: "ticket-b" } }),
    }));
    assert.equal(denied.status, 401);
    assert.equal((await store.get())?.ticket, "ticket-a");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("IT-AUTO-10: marketplace token chain uses app_ticket and never persists tenant tokens", async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const provider = createMarketplaceTokenProvider({
    appId: "cli-app",
    appSecret: "app-secret",
    ticketStore: { async get() { return { ticket: "ticket-a", receivedAt: 1 }; } },
    async fetch(input, init) {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      if (String(input).endsWith("/app_access_token")) {
        return Response.json({ code: 0, app_access_token: "app-token", expire: 7140 });
      }
      return Response.json({ code: 0, tenant_access_token: "tenant-token", expire: 7140 });
    },
  });
  assert.equal(await provider.getTenantAccessToken("tenant-a"), "tenant-token");
  assert.deepEqual(requests, [
    {
      url: "https://open.feishu.cn/open-apis/auth/v3/app_access_token",
      body: { app_id: "cli-app", app_secret: "app-secret", app_ticket: "ticket-a" },
    },
    {
      url: "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token",
      body: { app_access_token: "app-token", tenant_key: "tenant-a" },
    },
  ]);
});

test("IT-AUTO-10: Feishu ports validate field types, upload to the Base, and update only selected fields", async () => {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const ports = createFeishuBackgroundPorts({
    tokenProvider: { async getTenantAccessToken() { return "tenant-token"; } },
    async fetch(input, init) {
      const url = String(input);
      let body: unknown = init?.body;
      if (typeof init?.body === "string") body = JSON.parse(init.body);
      requests.push({ url, method: init?.method ?? "GET", body });
      if (url.includes("/fields")) {
        return Response.json({ code: 0, data: { has_more: false, items: [
          { field_id: "attachment-a", field_name: "生成文件", type: 17, ui_type: "Attachment" },
          { field_id: "status-a", field_name: "生成状态", type: 1, ui_type: "Text" },
          { field_id: "error-a", field_name: "错误信息", type: 1, ui_type: "Text" },
          { field_id: "number-a", field_name: "数量", type: 2, ui_type: "Number" },
        ] } });
      }
      if (url.includes("/medias/upload_all")) {
        return Response.json({ code: 0, data: { file_token: "file-token-a" } });
      }
      return Response.json({ code: 0, data: { record: { record_id: "record-a" } } });
    },
  });
  const job = {
    jobId: "job-a",
    taskKey: "task-a",
    status: "processing",
    attempt: 1,
    createdAt: 1,
    updatedAt: 1,
    submission: await buildBackgroundJobSubmission({
      context: { tenantKey: "tenant-a", baseToken: "base-a", tableId: "table-a", recordId: "record-a" },
      template: { id: "template-a", name: "发货单", revision: "r1", baseToken: "base-a", tableId: "table-a", snapshot: { pages: [] } },
      outputType: "pdf", referencedFieldIds: [], recordValues: {},
      targets: { attachmentFieldId: "attachment-a", statusFieldId: "status-a", errorFieldId: "error-a" },
    }),
  } as BackgroundJob;
  const targets = await ports.prepareTargets(job);
  assert.deepEqual(targets, {
    attachmentFieldName: "生成文件",
    statusFieldName: "生成状态",
    errorFieldName: "错误信息",
  });
  const fileToken = await ports.uploadArtifact(job, {
    artifactKey: job.submission.renderRequest.artifactKey,
    fileName: "发货单.pdf",
    contentType: "application/pdf",
    pageCount: 1,
    bytes: new TextEncoder().encode("%PDF-1.4\n%%EOF"),
  });
  assert.equal(fileToken, "file-token-a");
  await ports.updateRecord(job, targets, {
    "生成文件": [{ file_token: fileToken }],
    "生成状态": "生成成功",
    "错误信息": "",
  });
  const upload = requests.find((request) => request.url.includes("/medias/upload_all"));
  assert.ok(upload?.body instanceof FormData);
  assert.equal((upload.body as FormData).get("parent_type"), "bitable_file");
  assert.equal((upload.body as FormData).get("parent_node"), "base-a");
  const update = requests.find((request) => request.url.includes("/records/record-a"));
  assert.deepEqual(update?.body, { fields: {
    "生成文件": [{ file_token: "file-token-a" }],
    "生成状态": "生成成功",
    "错误信息": "",
  } });
});
