import assert from "node:assert/strict";
import test from "node:test";
import { createAutomationService } from "../src/automation/automation-service.ts";

const allowedOrigin = "https://blk_record_view.feishupkg.com";

function service() {
  const calls: string[] = [];
  const handler = (name: string, status = 200) => async () => {
    calls.push(name);
    return status === 204
      ? new Response(null, { status })
      : Response.json({ name }, { status });
  };
  return {
    calls,
    handle: createAutomationService({
      allowedOrigins: [allowedOrigin],
      oauthStart: handler("oauth-start", 302),
      oauthCallback: handler("oauth-callback"),
      registryAuthorization: handler("registry-authorization"),
      templateRegistry: handler("template-registry", 204),
      renderer: handler("renderer"),
      backgroundJobs: handler("background-jobs"),
      feishuEvents: handler("feishu-events"),
    }),
  };
}

test("SPEC-AUTO-08/14: service exposes only the locked health, OAuth, Registry, Renderer, job, and event routes", async () => {
  const { calls, handle } = service();
  const health = await handle(new Request("https://service.example/healthz"));
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });

  const cases = [
    ["GET", "/v1/oauth/start?state=a", "oauth-start"],
    ["GET", "/v1/oauth/callback?state=a&code=b", "oauth-callback"],
    ["POST", "/v1/registry-write-token", "registry-authorization"],
    ["POST", "/v1/templates", "template-registry"],
    ["POST", "/v1/render", "renderer"],
    ["POST", "/v1/background-jobs", "background-jobs"],
    ["POST", "/v1/feishu/events", "feishu-events"],
  ] as const;
  for (const [method, path, expected] of cases) {
    const headers = path === "/v1/registry-write-token"
      ? { origin: allowedOrigin }
      : undefined;
    await handle(new Request(`https://service.example${path}`, { method, headers }));
    assert.equal(calls.at(-1), expected);
  }

  const missing = await handle(new Request("https://service.example/internal/env"));
  assert.equal(missing.status, 404);
  assert.equal(JSON.stringify(await missing.json()).includes("secret"), false);
});

test("SPEC-AUTO-07/08: credentialed browser CORS is exact and preflight never reaches authorization", async () => {
  const { calls, handle } = service();
  const preflight = await handle(new Request(
    "https://service.example/v1/registry-write-token",
    {
      method: "OPTIONS",
      headers: {
        origin: allowedOrigin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    },
  ));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), allowedOrigin);
  assert.equal(preflight.headers.get("access-control-allow-credentials"), "true");
  assert.equal(preflight.headers.get("access-control-allow-methods"), "POST, OPTIONS");
  assert.equal(preflight.headers.get("access-control-allow-headers"), "content-type");
  assert.match(preflight.headers.get("vary") ?? "", /Origin/i);
  assert.deepEqual(calls, []);

  const actual = await handle(new Request(
    "https://service.example/v1/registry-write-token",
    { method: "POST", headers: { origin: allowedOrigin } },
  ));
  assert.equal(actual.headers.get("access-control-allow-origin"), allowedOrigin);
  assert.equal(actual.headers.get("access-control-allow-credentials"), "true");

  for (const origin of ["https://evil.example", `${allowedOrigin}.evil.example`]) {
    const denied = await handle(new Request(
      "https://service.example/v1/registry-write-token",
      { method: "OPTIONS", headers: { origin } },
    ));
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.has("access-control-allow-origin"), false);
  }
});

test("SPEC-AUTO-08: route methods fail closed before invoking business handlers", async () => {
  const { calls, handle } = service();
  const response = await handle(new Request("https://service.example/v1/render", { method: "GET" }));
  assert.equal(response.status, 405);
  assert.deepEqual(calls, []);
});
