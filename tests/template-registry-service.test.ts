import assert from "node:assert/strict";
import test from "node:test";
import {
  createAuthenticatedTemplateRegistry,
  signRegistryWriteRequest,
  type RegistryWriteRequest,
} from "../src/automation/template-registry-service.ts";

const secret = new TextEncoder().encode("goal-v22-registry-test-secret-that-is-long-enough");
const now = Date.parse("2026-10-12T08:00:00.000Z");

function request(overrides: Partial<RegistryWriteRequest> = {}): RegistryWriteRequest {
  return {
    scope: { tenantKey: "tenant-a", baseToken: "base-a", tableId: "table-a" },
    template: {
      id: "template-a",
      name: "发货单",
      revision: "revision-1",
      snapshot: { pages: [{ elements: [{ id: "title", type: "text", content: "发货单" }] }] },
      referencedFieldIds: ["field-a"],
    },
    ...overrides,
  };
}

test("CT-AUTO-03: a verified service signature authorizes one exact scoped write", async () => {
  const registry = createAuthenticatedTemplateRegistry({ signingSecret: secret, now: () => now });
  const body = request();
  const authorization = await signRegistryWriteRequest(body, {
    principalId: "user-a",
    tenantKey: "tenant-a",
    baseToken: "base-a",
    tableId: "table-a",
    canWrite: true,
  }, secret, now);
  await registry.upsert(body, authorization);
  assert.deepEqual((await registry.list(body.scope)).map((item) => item.name), ["发货单"]);
  assert.equal((await registry.get(body.scope, { id: "template-a", revision: "revision-1" }))?.status, "ready");
});

test("CT-AUTO-01/03: a newer revision replaces the old option for the same template", async () => {
  const registry = createAuthenticatedTemplateRegistry({ signingSecret: secret, now: () => now });
  const first = request();
  const second = request({
    template: { ...first.template, name: "发货单新版", revision: "revision-2" },
  });
  const identity = {
    principalId: "user-a",
    tenantKey: "tenant-a",
    baseToken: "base-a",
    tableId: "table-a",
    canWrite: true,
  };
  await registry.upsert(first, await signRegistryWriteRequest(first, identity, secret, now));
  await registry.upsert(second, await signRegistryWriteRequest(second, identity, secret, now));

  const listed = await registry.list(first.scope);
  assert.deepEqual(listed.map((item) => [item.name, item.revision]), [["发货单新版", "revision-2"]]);
  assert.equal(await registry.get(first.scope, { id: "template-a", revision: "revision-1" }), null);
  assert.equal((await registry.get(first.scope, { id: "template-a", revision: "revision-2" }))?.name, "发货单新版");
});

test("CT-AUTO-01/03: a signed tombstone removes the template option and invalidates old selections", async () => {
  const registry = createAuthenticatedTemplateRegistry({ signingSecret: secret, now: () => now });
  const first = request();
  const removed = request({ template: { ...first.template, status: "deleted" } });
  const identity = {
    principalId: "user-a",
    tenantKey: "tenant-a",
    baseToken: "base-a",
    tableId: "table-a",
    canWrite: true,
  };
  await registry.upsert(first, await signRegistryWriteRequest(first, identity, secret, now));
  await registry.upsert(removed, await signRegistryWriteRequest(removed, identity, secret, now));

  assert.deepEqual(await registry.list(first.scope), []);
  assert.equal((await registry.get(first.scope, {
    id: first.template.id,
    revision: first.template.revision,
  }))?.status, "deleted");
});

test("CT-AUTO-03: anonymous, read-only, tampered, expired, and cross-scope writes are rejected", async () => {
  const body = request();
  const registry = createAuthenticatedTemplateRegistry({ signingSecret: secret, now: () => now });
  await assert.rejects(registry.upsert(body, "tenant-a/base-a/table-a"), /身份|签名/);

  const readOnly = await signRegistryWriteRequest(body, {
    principalId: "user-a", tenantKey: "tenant-a", baseToken: "base-a", tableId: "table-a", canWrite: false,
  }, secret, now);
  await assert.rejects(registry.upsert(body, readOnly), /写入权限/);

  const valid = await signRegistryWriteRequest(body, {
    principalId: "user-a", tenantKey: "tenant-a", baseToken: "base-a", tableId: "table-a", canWrite: true,
  }, secret, now);
  await assert.rejects(registry.upsert(request({ template: { ...body.template, name: "被篡改" } }), valid), /签名|内容/);

  const expired = await signRegistryWriteRequest(body, {
    principalId: "user-a", tenantKey: "tenant-a", baseToken: "base-a", tableId: "table-a", canWrite: true,
  }, secret, now - 10 * 60_000);
  await assert.rejects(registry.upsert(body, expired), /过期/);

  const crossScope = await signRegistryWriteRequest(body, {
    principalId: "user-a", tenantKey: "tenant-b", baseToken: "base-a", tableId: "table-a", canWrite: true,
  }, secret, now);
  await assert.rejects(registry.upsert(body, crossScope), /作用域/);
});

test("SPEC-SEC-01/AUTO-07: registry rejects credentials and runtime record values", async () => {
  const registry = createAuthenticatedTemplateRegistry({ signingSecret: secret, now: () => now });
  for (const snapshot of [
    { authorization: "Bearer secret" },
    { tenantAccessToken: "secret" },
    { recordValues: { "field-a": "SO-001" } },
  ]) {
    const body = request({ template: { ...request().template, snapshot } });
    const authorization = await signRegistryWriteRequest(body, {
      principalId: "user-a", tenantKey: "tenant-a", baseToken: "base-a", tableId: "table-a", canWrite: true,
    }, secret, now);
    await assert.rejects(registry.upsert(body, authorization), /敏感凭据|运行数据/);
  }
});
