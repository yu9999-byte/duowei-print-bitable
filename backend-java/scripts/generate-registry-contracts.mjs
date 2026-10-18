import { build } from "../../miaoda-duowei-automation/node_modules/esbuild/lib/main.js";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash, createHmac } from "node:crypto";
const source = fileURLToPath(new URL("../../miaoda-duowei-automation/server/duowei-core/template-registry-service.ts", import.meta.url));
const built = await build({ entryPoints: [source], bundle: true, platform: "node", format: "esm", write: false });
const original = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
const scope = { tenantKey: "tenant", baseToken: "base", tableId: "table" };
const cases = [
  { id: "missing-signature", body: {}, signature: "" },
  { id: "read-missing-scope", body: { operation: "list" }, signature: "test" },
  { id: "read-array-scope", body: { operation: "list", scope: [] }, signature: "test" },
  { id: "read-empty-tenant", body: { operation: "list", scope: { ...scope, tenantKey: " " } }, signature: "test" },
  { id: "unknown-operation", body: { operation: "other", scope }, signature: "test" },
  { id: "get-missing-selection", body: { operation: "get", scope }, signature: "test" },
  { id: "get-empty-revision", body: { operation: "get", scope, selection: { id: "t", revision: "" } }, signature: "test" }
];
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
for (const body of [
  { operation: "list", scope },
  { operation: "get", scope, selection: { id: "t", revision: "r1" } },
  { scope, template: { id: "t", revision: "r1", name: "测试模板", snapshot: { pages: [] }, referencedFieldIds: [] } }
]) {
  const read = Object.hasOwn(body, "operation");
  const claims = { version: 1, audience: read ? "duowei-template-registry-read" : "duowei-template-registry-write", issuedAt: 1, expiresAt: 41024448e5, bodyDigest: createHash("sha256").update(canonical(body)).digest("base64url"), ...read ? {} : { ...scope, principalId: "test-user", canWrite: true } };
  const prefix = read ? "duowei-registry-read-v1" : "duowei-registry-v1";
  const payload = `${prefix}.${Buffer.from(canonical(claims)).toString("base64url")}`;
  cases.push({ id: read ? `valid-${body.operation}` : "valid-write", body, signature: `${payload}.${createHmac("sha256", Buffer.alloc(32)).update(payload).digest("base64url")}`, storeOperation: read ? body.operation : "upsert" });
}
let calls = [];
const registry = original.createAuthenticatedTemplateRegistry({ signingSecret: new Uint8Array(32), readSigningSecret: new Uint8Array(32), store: {
  upsert: async () => {
    calls.push("upsert");
  },
  list: async () => {
    calls.push("list");
    return [];
  },
  get: async () => {
    calls.push("get");
    return null;
  }
} });
const handler = original.createTemplateRegistryHttpHandler({ registry });
for (const item of cases) {
  calls = [];
  const response = await handler(new Request("https://test.invalid/registry", { method: "POST", headers: { "content-type": "application/json", "x-duowei-service-signature": item.signature }, body: JSON.stringify(item.body) }));
  const body = response.status === 204 ? null : await response.json();
  if (!response.headers.get("x-duowei-trace-id")) throw new Error("Missing trace");
  if (body?.traceId && body.traceId !== response.headers.get("x-duowei-trace-id")) throw new Error("Trace correlation failed");
  if (body) delete body.traceId;
  if (JSON.stringify(calls) !== JSON.stringify(item.storeOperation ? [item.storeOperation] : [])) throw new Error("Unexpected original store calls");
  item.expected = { status: response.status, body };
}
await writeFile(new URL("../src/test/resources/registry-contracts.json", import.meta.url), JSON.stringify(cases, null, 2) + "\n");
console.log(`Generated ${cases.length} original registry contracts.`);
