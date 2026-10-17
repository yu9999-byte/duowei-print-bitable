import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { transform } from "../../miaoda-duowei-automation/node_modules/esbuild/lib/main.js";
const origin = "https://plugin.example";
const service = "https://service.example";
const pendingKey = "duowei-print:pending-template-sync";
const script = (await readFile(new URL("../src/main/resources/bridge.js", import.meta.url), "utf8")).replace("__ALLOWED_ORIGINS__", JSON.stringify([origin])).replace("__AUTHORIZATION_URL__", JSON.stringify(`${service}/api/automation/registry-write-token`)).replace("__REGISTRY_URL__", JSON.stringify(`${service}/api/automation/registry`)).replace("__OAUTH_START_PATH__", JSON.stringify("/api/automation/oauth/start"));
const originalSource = await readFile(new URL("../../miaoda-duowei-automation/server/modules/automation/automation-bridge-document.ts", import.meta.url), "utf8");
const compiled = await transform(originalSource, { loader: "ts", format: "esm" });
const original = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`);
const originalHtml = original.automationBridgeDocument([origin], new URL(`${service}/openapi/duowei-print`)).html;
const originalScript = originalHtml.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
assert.ok(originalScript, "Original bridge script must be extractable");
assert.equal(script.trim(), originalScript.trim(), "Java bridge resource must preserve original runtime script");
function createPage(responses, pending) {
  const messages = [];
  const calls = [];
  const redirects = [];
  const storage = new Map(pending ? [[pendingKey, JSON.stringify(pending)]] : []);
  const status = { textContent: "", dataset: {} };
  const opener = { postMessage: (body, target) => messages.push({ body, target }) };
  let onMessage;
  const context = vm.createContext({
    URL,
    document: { getElementById: () => status },
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    },
    window: {
      opener,
      location: { origin: service, assign: (url) => redirects.push(url) },
      addEventListener: (type, handler) => {
        if (type === "message") onMessage = handler;
      }
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      const response = responses.shift();
      assert.ok(response, "Unexpected bridge fetch");
      return { ...response, ok: response.status < 400, json: async () => response.body };
    }
  });
  vm.runInContext(script, context);
  return {
    messages,
    calls,
    redirects,
    storage,
    status,
    opener,
    send: (data, eventOrigin = origin, source = opener) => onMessage({ data, origin: eventOrigin, source })
  };
}
const sync = { type: "duowei-print:bridge-sync", protocolVersion: 1, requestId: "sync-1", body: { scope: {} } };
const success = () => [
  { status: 200, body: { success: true, authorization: "signed-secret", body: { scope: { tenantKey: "tenant" } } } },
  { status: 204 }
];
const page = createPage(success());
await page.send(sync, "https://evil.example");
await page.send(sync, origin, {});
await page.send({ ...sync, protocolVersion: 2 });
assert.equal(page.calls.length, 0);
await page.send({ type: "duowei-print:bridge-probe", protocolVersion: 1 });
assert.equal(page.messages[0].body.type, "duowei-print:oauth-connected");
await page.send(sync);
assert.equal(page.calls.length, 2);
assert.equal(page.calls[0].options.headers["x-duowei-plugin-origin"], origin);
assert.equal(page.calls[1].options.headers["x-duowei-service-signature"], "signed-secret");
assert.equal(page.messages[1].body.success, true);
assert.equal(page.messages[1].target, origin);
assert.ok(!JSON.stringify(page.messages).includes("signed-secret"));
const failure = createPage([{ status: 401, body: { code: "IDENTITY_INVALID", message: "Bearer abc.def access_token=private" } }]);
await failure.send(sync);
assert.equal(failure.messages[0].body.success, false);
assert.ok(!failure.messages[0].body.message.includes("abc.def"));
assert.ok(!failure.messages[0].body.message.includes("private"));
const connectUrl = `${service}/api/automation/oauth/start?state=test-state`;
const connecting = createPage([{ status: 401, body: { code: "AUTH_REQUIRED", connectUrl } }]);
await connecting.send(sync);
assert.equal(connecting.redirects[0], connectUrl);
const saved = JSON.parse(connecting.storage.get(pendingKey));
const resumed = createPage(success(), saved);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(resumed.messages[0].body.success, true);
assert.equal(resumed.storage.has(pendingKey), false);
const expired = createPage([], { ...saved, createdAt: Date.now() - 301e3 });
assert.equal(expired.calls.length, 0);
assert.equal(expired.storage.has(pendingKey), false);
const foreign = createPage([{ status: 401, body: { code: "AUTH_REQUIRED", connectUrl: "https://evil.example/oauth/start" } }]);
await foreign.send(sync);
assert.equal(foreign.redirects.length, 0);
assert.equal(foreign.messages[0].body.success, false);
console.log("Bridge script verified: source/origin/version, probe, sync, redaction, OAuth resume, expired state, redirect scope.");
