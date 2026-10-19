import { build } from "../../miaoda-duowei-automation/node_modules/esbuild/lib/main.js";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../miaoda-duowei-automation/server/duowei-core/", import.meta.url));
const built = await build({ stdin: { contents: 'export * from "./registry-write-authorization"; export * from "./feishu-oauth-session";', resolveDir: root }, bundle: true, platform: "node", format: "esm", write: false });
const original = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
const oauth = original.createFeishuOAuthSessionService({ clientId: "cli_test", clientSecret: "local-test", redirectUri: "https://service.example/api/automation/oauth/callback", oauthStartUrl: "https://service.example/api/automation/oauth/start", bridgeReturnUrl: "https://service.example/api/automation/bridge", allowedOrigins: ["https://plugin.example"], fetch: async () => {
  throw new Error("Unexpected platform call");
} });
const handler = original.createRegistryWriteAuthorizationHttpHandler({ signingSecret: new Uint8Array(32), verifyIdentity: oauth.verifyIdentity });
const valid = { scope: { baseToken: "base", tableId: "table" }, template: {} };
const cases = [null, [], 42, {}, { scope: {}, template: {} }, { ...valid, extra: true }, { ...valid, scope: { ...valid.scope, tenantKey: "tenant" } }, { ...valid, template: [] }].map((body, index) => ({ id: "invalid-" + index, body, origin: "https://plugin.example" }));
cases.push({ id: "untrusted", body: valid, origin: "https://evil.example" }, { id: "connection-required", body: valid, origin: "https://plugin.example" });
for (const item of cases) {
  const response = await handler(new Request("https://service.example/api/automation/registry-write-token", { method: "POST", headers: { "content-type": "application/json", origin: item.origin }, body: JSON.stringify(item.body) }));
  const body = await response.json();
  delete body.traceId;
  if (body.connectUrl) {
    const url = new URL(body.connectUrl);
    if (!url.searchParams.get("state")) throw Error("Missing state");
    url.searchParams.set("state", "DYNAMIC");
    body.connectUrl = url.toString();
  }
  item.expected = { status: response.status, body };
}
await writeFile(new URL("../src/test/resources/authorization-contracts.json", import.meta.url), JSON.stringify(cases, null, 2) + "\n");
console.log(`Generated ${cases.length} authorization contracts`);
