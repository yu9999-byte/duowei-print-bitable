import assert from "node:assert/strict";
import test from "node:test";
import {
  createAuthenticatedTemplateRegistry,
  createTemplateRegistryHttpHandler,
  createTemplateRegistryHttpReader,
  createTemplateRegistryHttpTransport,
  signRegistryReadRequest,
  signRegistryWriteRequest,
  type RegistryWriteRequest,
} from "../src/automation/template-registry-service.ts";

const secret = new TextEncoder().encode("registry-http-test-secret-that-is-long-enough");
const now = 1_800_000_000_000;

function body(): RegistryWriteRequest {
  return {
    scope: { tenantKey: "tenant-a", baseToken: "base-a", tableId: "table-a" },
    template: {
      id: "template-a",
      name: "发货单",
      revision: "revision-a",
      snapshot: { canvasSize: { width: 600, height: 800 }, pages: [] },
      referencedFieldIds: ["field-a"],
    },
  };
}

test("SPEC-AUTO-07: registry HTTP port accepts an exact signed write and exposes no anonymous write", async () => {
  const registry = createAuthenticatedTemplateRegistry({ signingSecret: secret, now: () => now });
  const handler = createTemplateRegistryHttpHandler({ registry });
  const token = await signRegistryWriteRequest(body(), {
    principalId: "user-a",
    ...body().scope,
    canWrite: true,
  }, secret, now);
  const response = await handler(new Request("https://registry.example/v1/templates", {
    method: "POST",
    headers: { "x-duowei-service-signature": token, "content-type": "application/json" },
    body: JSON.stringify(body()),
  }));
  assert.equal(response.status, 204);
  assert.equal((await registry.list(body().scope))[0]?.name, "发货单");

  const anonymous = await handler(new Request("https://registry.example/v1/templates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body()),
  }));
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json() as { traceId?: string }).traceId?.length! > 0, true);
});

test("SPEC-AUTO-07: registry transport preserves the signed token and reports server errors", async () => {
  const registry = createAuthenticatedTemplateRegistry({ signingSecret: secret, now: () => now });
  const handler = createTemplateRegistryHttpHandler({ registry });
  const transport = createTemplateRegistryHttpTransport({
    endpoint: "https://registry.example/v1/templates",
    fetch(input, init) { return handler(new Request(input, init)); },
  });
  const token = await signRegistryWriteRequest(body(), {
    principalId: "user-a",
    ...body().scope,
    canWrite: true,
  }, secret, now);
  await transport.upsert(body(), token);
  assert.equal((await registry.list(body().scope)).length, 1);
  await assert.rejects(transport.upsert({ ...body(), template: { ...body().template, name: "tampered" } }, token),
    /签名|内容/);
});

test("SPEC-AUTO-02/07: automation reader lists and gets only its signed scope", async () => {
  const registry = createAuthenticatedTemplateRegistry({ signingSecret: secret, now: () => now });
  const writeToken = await signRegistryWriteRequest(body(), {
    principalId: "user-a", ...body().scope, canWrite: true,
  }, secret, now);
  await registry.upsert(body(), writeToken);
  const handler = createTemplateRegistryHttpHandler({ registry, readSigningSecret: secret, now: () => now });
  const reader = createTemplateRegistryHttpReader({
    endpoint: "https://registry.example/v1/templates",
    signingSecret: secret,
    now: () => now,
    fetch(input, init) { return handler(new Request(input, init)); },
  });

  assert.deepEqual((await reader.list(body().scope)).map((item) => item.name), ["发货单"]);
  assert.equal((await reader.get(body().scope, { id: "template-a", revision: "revision-a" }))?.name, "发货单");
  assert.equal(await reader.get(body().scope, { id: "template-a", revision: "missing" }), null);

  const readBody = { operation: "list" as const, scope: body().scope };
  const token = await signRegistryReadRequest(readBody, secret, now);
  const crossScope = { operation: "list" as const, scope: { ...body().scope, tableId: "table-b" } };
  const response = await handler(new Request("https://registry.example/v1/templates", {
    method: "POST",
    headers: { "x-duowei-service-signature": token, "content-type": "application/json" },
    body: JSON.stringify(crossScope),
  }));
  assert.equal(response.status, 401);
});
