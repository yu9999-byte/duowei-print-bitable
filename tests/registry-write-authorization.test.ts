import assert from "node:assert/strict";
import test from "node:test";
import {
  createAuthenticatedTemplateRegistry,
  type RegistryWriteDraftRequest,
  type RegistryWriteRequest,
} from "../src/automation/template-registry-service.ts";
import {
  createRegistryWriteAuthorizationClient,
  createRegistryWriteAuthorizationHttpHandler,
} from "../src/automation/registry-write-authorization.ts";

const secret = new TextEncoder().encode("registry-authorization-test-secret-long-enough");
const now = 1_800_000_000_000;

function draft(): RegistryWriteDraftRequest {
  return {
    scope: { baseToken: "base-a", tableId: "table-a" },
    template: {
      id: "template-a",
      name: "发货单",
      revision: "revision-a",
      snapshot: { canvasSize: { width: 600, height: 800 }, pages: [] },
      referencedFieldIds: ["field-a"],
    },
  };
}

function body(): RegistryWriteRequest {
  return { ...draft(), scope: { tenantKey: "tenant-a", ...draft().scope } };
}

test("SPEC-AUTO-07: verified Feishu session mints one exact scoped registry write signature", async () => {
  const handler = createRegistryWriteAuthorizationHttpHandler({
    signingSecret: secret,
    now: () => now,
    async verifyIdentity(request, requestBody) {
      assert.equal(request.headers.get("cookie"), "feishu_session=verified");
      return { principalId: "user-a", tenantKey: "tenant-a", ...requestBody.scope, canWrite: true };
    },
  });
  const client = createRegistryWriteAuthorizationClient({
    endpoint: "https://auth.example/v1/registry-write-token",
    async fetch(input, init) {
      const headers = new Headers(init?.headers);
      headers.set("cookie", "feishu_session=verified");
      return handler(new Request(input, { ...init, headers }));
    },
  });
  const authorized = await client.authorize(draft());
  const registry = createAuthenticatedTemplateRegistry({ signingSecret: secret, now: () => now });
  await registry.upsert(authorized.body, authorized.authorization);
  assert.equal(authorized.body.scope.tenantKey, "tenant-a");
  assert.equal((await registry.list(body().scope))[0]?.name, "发货单");
});

test("SPEC-AUTO-07/08: anonymous and cross-scope sessions cannot mint write signatures", async () => {
  for (const verifyIdentity of [
    async () => { throw new Error("session missing"); },
    async () => ({ principalId: "user-a", ...body().scope, tableId: "table-b", canWrite: true }),
    async () => ({ principalId: "user-a", ...body().scope, canWrite: false }),
  ]) {
    const handler = createRegistryWriteAuthorizationHttpHandler({
      signingSecret: secret,
      now: () => now,
      verifyIdentity,
    });
    const response = await handler(new Request("https://auth.example/v1/registry-write-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft()),
    }));
    assert.equal(response.status, 401);
    const error = await response.json() as { authorization?: string; traceId?: string };
    assert.equal(error.authorization, undefined);
    assert.ok(error.traceId);
  }
});

test("SPEC-AUTO-07/08: the browser cannot provide or override tenant identity", async () => {
  const handler = createRegistryWriteAuthorizationHttpHandler({
    signingSecret: secret,
    now: () => now,
    async verifyIdentity(_request, requestBody) {
      return { principalId: "user-a", tenantKey: "tenant-a", ...requestBody.scope, canWrite: true };
    },
  });
  const forged = {
    ...draft(),
    scope: { tenantKey: "tenant-forged", ...draft().scope },
  };
  const response = await handler(new Request("https://auth.example/v1/registry-write-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(forged),
  }));
  assert.equal(response.status, 400);
});
