import assert from "node:assert/strict";
import test from "node:test";
import {
  createFeishuOAuthSessionService,
} from "../src/automation/feishu-oauth-session.ts";
import {
  createRegistryWriteAuthorizationClient,
  createRegistryWriteAuthorizationHttpHandler,
  RegistryConnectionRequiredError,
} from "../src/automation/registry-write-authorization.ts";
import type { RegistryWriteDraftRequest } from "../src/automation/template-registry-service.ts";

const now = 1_800_000_000_000;
const pluginOrigin = "https://blk_record_view.feishupkg.com";
const serviceOrigin = "https://automation.duowei.example";

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

async function rejected(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("expected promise to reject");
}

function createHarness(options: { canEdit?: boolean } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const oauth = createFeishuOAuthSessionService({
    clientId: "cli_aa3a18dc8eb95bd1",
    clientSecret: "server-only-app-secret",
    redirectUri: `${serviceOrigin}/v1/oauth/callback`,
    serviceBaseUrl: serviceOrigin,
    allowedOrigins: [pluginOrigin],
    now: () => now,
    async fetch(input, init) {
      const url = String(input);
      calls.push({ url, init });
      if (url === "https://accounts.feishu.cn/oauth/v3/token") {
        assert.equal(init?.method, "POST");
        const body = new URLSearchParams(String(init?.body));
        assert.equal(body.get("grant_type"), "authorization_code");
        assert.equal(body.get("client_id"), "cli_aa3a18dc8eb95bd1");
        assert.equal(body.get("client_secret"), "server-only-app-secret");
        assert.equal(body.get("code"), "oauth-code");
        assert.ok((body.get("code_verifier")?.length ?? 0) >= 43);
        return Response.json({
          code: 0,
          access_token: "user-access-token",
          token_type: "Bearer",
          expires_in: 7200,
          scope: "bitable:app",
        });
      }
      if (url === "https://open.feishu.cn/open-apis/authen/v1/user_info") {
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer user-access-token");
        return Response.json({
          code: 0,
          data: { open_id: "ou-user-a", tenant_key: "tenant-a" },
        });
      }
      if (url.includes("/open-apis/drive/v1/permissions/base-a/members/auth")) {
        const parsed = new URL(url);
        assert.equal(parsed.searchParams.get("type"), "bitable");
        assert.equal(parsed.searchParams.get("action"), "edit");
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer user-access-token");
        return Response.json({ code: 0, data: { auth_result: options.canEdit ?? true } });
      }
      throw new Error(`unexpected request: ${url}`);
    },
  });
  return { oauth, calls };
}

test("SPEC-AUTO-07: an anonymous record-view receives a one-time Feishu OAuth connection URL", async () => {
  const { oauth } = createHarness();
  const handler = createRegistryWriteAuthorizationHttpHandler({
    signingSecret: new TextEncoder().encode("registry-authorization-test-secret-long-enough"),
    verifyIdentity: oauth.verifyIdentity,
    now: () => now,
  });
  const client = createRegistryWriteAuthorizationClient({
    endpoint: `${serviceOrigin}/v1/registry-write-token`,
    fetch(input, init = {}) {
      const headers = new Headers(init.headers);
      headers.set("origin", pluginOrigin);
      return handler(new Request(input, { ...init, headers }));
    },
  });

  await assert.rejects(client.authorize(draft()), (error: unknown) => {
    assert.ok(error instanceof RegistryConnectionRequiredError);
    const connectUrl = new URL(error.connectUrl);
    assert.equal(connectUrl.origin, serviceOrigin);
    assert.equal(connectUrl.pathname, "/v1/oauth/start");
    assert.ok(connectUrl.searchParams.get("state"));
    assert.equal(error.message.includes("server-only-app-secret"), false);
    return true;
  });
});

test("SPEC-AUTO-07: PKCE callback creates a scope-bound HttpOnly session and retry authorizes the exact draft", async () => {
  const { oauth } = createHarness();
  const required = await rejected(
    oauth.verifyIdentity(new Request(`${serviceOrigin}/v1/registry-write-token`, {
      headers: { origin: pluginOrigin },
    }), draft()),
  );
  assert.ok(required instanceof RegistryConnectionRequiredError);
  const start = await oauth.handleStart(new Request(required.connectUrl));
  assert.equal(start.status, 302);
  const authorizationUrl = new URL(start.headers.get("location")!);
  assert.equal(authorizationUrl.origin, "https://accounts.feishu.cn");
  assert.equal(authorizationUrl.pathname, "/open-apis/authen/v1/authorize");
  assert.equal(authorizationUrl.searchParams.get("client_id"), "cli_aa3a18dc8eb95bd1");
  assert.equal(authorizationUrl.searchParams.get("response_type"), "code");
  assert.equal(authorizationUrl.searchParams.get("scope"), "bitable:app");
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorizationUrl.searchParams.get("code_challenge"));

  const state = authorizationUrl.searchParams.get("state")!;
  const callback = await oauth.handleCallback(new Request(
    `${serviceOrigin}/v1/oauth/callback?code=oauth-code&state=${encodeURIComponent(state)}`,
  ));
  assert.equal(callback.status, 200);
  const cookie = callback.headers.get("set-cookie")!;
  assert.match(cookie, /^__Host-duowei_oauth_session=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=None/i);
  const callbackHtml = await callback.text();
  assert.match(callbackHtml, /duowei-print:oauth-connected/);
  assert.equal(callbackHtml.includes("user-access-token"), false);

  const identity = await oauth.verifyIdentity(new Request(
    `${serviceOrigin}/v1/registry-write-token`,
    { headers: { origin: pluginOrigin, cookie: cookie.split(";", 1)[0] } },
  ), draft());
  assert.deepEqual(identity, {
    principalId: "ou-user-a",
    tenantKey: "tenant-a",
    baseToken: "base-a",
    tableId: "table-a",
    canWrite: true,
  });

  const replay = await oauth.handleCallback(new Request(
    `${serviceOrigin}/v1/oauth/callback?code=oauth-code&state=${encodeURIComponent(state)}`,
  ));
  assert.equal(replay.status, 400);
  assert.equal(replay.headers.has("set-cookie"), false);
});

test("SPEC-AUTO-07/08: OAuth refuses untrusted origins, denied Base edit access, and cross-table reuse", async () => {
  const { oauth } = createHarness({ canEdit: false });
  await assert.rejects(oauth.verifyIdentity(new Request(
    `${serviceOrigin}/v1/registry-write-token`,
    { headers: { origin: "https://evil.example" } },
  ), draft()), /来源/);

  const required = await rejected(oauth.verifyIdentity(new Request(
    `${serviceOrigin}/v1/registry-write-token`,
    { headers: { origin: pluginOrigin } },
  ), draft()));
  assert.ok(required instanceof RegistryConnectionRequiredError);
  const start = await oauth.handleStart(new Request(required.connectUrl));
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  const denied = await oauth.handleCallback(new Request(
    `${serviceOrigin}/v1/oauth/callback?code=oauth-code&state=${encodeURIComponent(state)}`,
  ));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.has("set-cookie"), false);
  assert.match(await denied.text(), /编辑权限/);
});

test("SPEC-AUTO-08: upstream OAuth errors cannot inject callback HTML or script", async () => {
  const oauth = createFeishuOAuthSessionService({
    clientId: "cli_aa3a18dc8eb95bd1",
    clientSecret: "server-only-app-secret",
    redirectUri: `${serviceOrigin}/v1/oauth/callback`,
    serviceBaseUrl: serviceOrigin,
    allowedOrigins: [pluginOrigin],
    now: () => now,
    async fetch() {
      return Response.json({
        code: 20050,
        error_description: "</script><img src=x onerror=alert(1)>",
      }, { status: 400 });
    },
  });
  const required = await rejected(oauth.verifyIdentity(new Request(
    `${serviceOrigin}/v1/registry-write-token`,
    { headers: { origin: pluginOrigin } },
  ), draft()));
  assert.ok(required instanceof RegistryConnectionRequiredError);
  const start = await oauth.handleStart(new Request(required.connectUrl));
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  const callback = await oauth.handleCallback(new Request(
    `${serviceOrigin}/v1/oauth/callback?code=oauth-code&state=${encodeURIComponent(state)}`,
  ));
  const html = await callback.text();
  assert.equal(callback.status, 502);
  assert.doesNotMatch(html, /<img|<\/script><img/i);
  assert.match(html, /&lt;\/script&gt;&lt;img/);
  assert.ok(html.includes("\\u003c/script\\u003e"));
});
