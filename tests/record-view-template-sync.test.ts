import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { StoredTemplate } from "../src/core/template-repository.ts";
import { createRecordViewAutomationTemplateSync } from "../src/host/automation-template-sync.ts";

function stored(): StoredTemplate {
  return {
    id: "template-a",
    name: "发货单",
    checksum: "fnv1a32:12345678",
    updatedAt: "2026-10-13T10:00:00.000Z",
    template: {
      canvasSize: { width: 600, height: 800 },
      pages: [{ elements: [{ type: "text", content: "订单：@__duowei_field_field-a" }] }],
    },
  };
}

test("SPEC-AUTO-07: record-view sync is disabled only when both public endpoints are absent", () => {
  assert.equal(createRecordViewAutomationTemplateSync({
    authorizationEndpoint: "",
    registryEndpoint: "",
  }), null);

  for (const config of [
    { authorizationEndpoint: "https://service.example/authorize", registryEndpoint: "" },
    { authorizationEndpoint: "", registryEndpoint: "https://service.example/templates" },
    { authorizationEndpoint: "http://service.example/authorize", registryEndpoint: "https://service.example/templates" },
    { authorizationEndpoint: "https://user:secret@service.example/authorize", registryEndpoint: "https://service.example/templates" },
  ]) {
    assert.throws(() => createRecordViewAutomationTemplateSync(config), /配置|HTTPS|凭据/);
  }
});

test("SPEC-AUTO-07: bridge configuration replaces cross-origin credentialed fetch", async () => {
  const calls: Array<{ message: unknown; origin: string }> = [];
  const target = {
    closed: false,
    postMessage(message: unknown, origin: string) { calls.push({ message, origin }); },
  };
  const sync = createRecordViewAutomationTemplateSync({
    authorizationEndpoint: "",
    registryEndpoint: "",
    bridgeEndpoint: "https://service.example/api/automation/bridge",
  });
  assert.ok(sync?.bridge);
  await assert.rejects(
    sync.sync({ baseToken: "base-a", tableId: "table-a" }, stored()),
    (error: unknown) => error instanceof Error
      && error.name === "RegistryConnectionRequiredError"
      && /连接多维打印自动化服务/.test(error.message),
  );

  sync.bridge.connect(target);
  const resultPromise = sync.sync({ baseToken: "base-a", tableId: "table-a" }, stored());
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].origin, "https://service.example");
  const request = calls[0].message as { requestId: string; body: unknown; type: string };
  assert.equal(request.type, "duowei-print:bridge-sync");
  assert.equal(JSON.stringify(request.body).includes("tenantKey"), false);
  assert.equal(sync.bridge.handleMessage({
    source: target,
    origin: "https://service.example",
    data: { type: "duowei-print:bridge-result", requestId: request.requestId, success: true },
  }), true);
  assert.deepEqual(await resultPromise, {
    status: "ready",
    templateId: "template-a",
    revision: "fnv1a32:12345678",
  });
  sync.bridge.dispose();
});

test("SPEC-AUTO-02/07: a saved record-view template obtains scoped authorization then writes the exact body", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const sync = createRecordViewAutomationTemplateSync({
    authorizationEndpoint: "https://service.example/authorize",
    registryEndpoint: "https://service.example/templates",
  }, async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/authorize")) {
      const draft = JSON.parse(String(init.body)) as Record<string, unknown>;
      return Response.json({
        authorization: "scoped-write-signature",
        body: {
          ...draft,
          scope: { tenantKey: "tenant-a", baseToken: "base-a", tableId: "table-a" },
        },
      });
    }
    return new Response(null, { status: 204 });
  });

  assert.ok(sync);
  const result = await sync.sync({ baseToken: "base-a", tableId: "table-a" }, stored());
  assert.equal(result.status, "ready");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://service.example/authorize");
  assert.equal(calls[0].init.credentials, "include");
  assert.equal(calls[1].url, "https://service.example/templates");
  assert.equal(new Headers(calls[1].init.headers).get("x-duowei-service-signature"), "scoped-write-signature");
  assert.equal(new Headers(calls[1].init.headers).has("authorization"), false);
  assert.deepEqual(JSON.parse(String(calls[1].init.body)).scope, {
    tenantKey: "tenant-a",
    baseToken: "base-a",
    tableId: "table-a",
  });
});

test("CT-AUTO-05: App syncs only after bridge persistence and keeps save success on sync failure", () => {
  const source = readFileSync("src/App.vue", "utf8");
  const saveFlow = source.slice(
    source.indexOf("async function saveTemplate"),
    source.indexOf("function templateLayoutLabel"),
  );
  assert.ok(saveFlow.indexOf("templateRepository.upsert") < saveFlow.indexOf("templateSync.sync"));
  assert.match(saveFlow, /templateSync\.sync\([\s\S]*?baseToken:\s*active\.baseId[\s\S]*?tableId:\s*active\.tableId/);
  assert.match(saveFlow, /模板已保存，但自动化同步失败/);
  assert.match(saveFlow, /rememberAutomationConnection/);
  assert.match(saveFlow, /return true/);
});

test("CT-AUTO-05: template rename and removal synchronize after the directory mutation", () => {
  const source = readFileSync("src/App.vue", "utf8");
  const directoryFlow = source.slice(
    source.indexOf("async function updateDirectory"),
    source.indexOf("async function requestDirectoryAction"),
  );
  assert.ok(directoryFlow.indexOf("templateRepository.rename") < directoryFlow.indexOf("templateSync.sync"));
  assert.ok(directoryFlow.indexOf("templateRepository.remove") < directoryFlow.indexOf("templateSync.remove"));
  assert.match(directoryFlow, /模板目录已更新，但自动化同步失败/);
  assert.match(directoryFlow, /rememberAutomationConnection/);
  assert.match(directoryFlow, /return true/);
});

test("SPEC-AUTO-07: record-view exposes connection only after AUTH_REQUIRED and validates popup messages", () => {
  const source = readFileSync("src/App.vue", "utf8");
  assert.match(source, /error instanceof RegistryConnectionRequiredError/);
  assert.match(source, /v-if="automationConnectUrl"[\s\S]*?连接自动化/);
  assert.match(source, /event\.source !== automationConnectionWindow/);
  assert.match(source, /event\.origin !== new URL\(automationConnectUrl\.value\)\.origin/);
  assert.match(source, /duowei-print:oauth-connected/);
  assert.match(source, /bridge\.probe\(popup\)/);
  assert.match(source, /bridge\?\.connect\(automationConnectionWindow\)/);
  assert.match(source, /bridge\?\.handleMessage\(event\)/);
  assert.match(source, /await retry\(\)/);
});

test("SPEC-AUTO-08: record-view upload refuses an unconfigured automation sync release", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  assert.match(packageJson.scripts.upload, /check-record-view-sync-env/);
  const checker = readFileSync("scripts/check-record-view-sync-env.mjs", "utf8");
  assert.match(checker, /DUOWEI_TEMPLATE_SYNC_BRIDGE_ENDPOINT/);
  assert.match(checker, /https:/);
});
