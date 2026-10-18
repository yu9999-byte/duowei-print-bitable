import { build } from "../../miaoda-duowei-automation/node_modules/esbuild/lib/main.js";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash, createHmac } from "node:crypto";
const core = fileURLToPath(new URL("../../miaoda-duowei-automation/server/duowei-core/", import.meta.url));
const built = await build({ stdin: { contents: 'export * from "./background-job"; export * from "./background-job-service";', resolveDir: core }, bundle: true, platform: "node", format: "esm", write: false });
const original = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
const body = { version: 1, taskKey: "duowei-job:v1:" + "a".repeat(64), tenantKey: "tenant", baseToken: "base", tableId: "table", recordId: "record", outputType: "pdf", renderRequest: { artifactKey: "duowei:v1:test", output: { type: "pdf" } }, targets: { attachmentFieldId: "a", statusFieldId: "s" } };
const cases = [{ id: "empty", body: {} }, { id: "null-body", body: null }, { id: "array-body", body: [] }, { id: "number-body", body: 42 }];
for (const [field, value] of [["version", 2], ["taskKey", "wrong"], ["outputType", "other"], ["tenantKey", ""], ["baseToken", ""], ["tableId", ""], ["recordId", ""], ["targets", null], ["targets", {}], ["targets", { attachmentFieldId: "a" }], ["targets", { attachmentFieldId: "a", statusFieldId: "a" }], ["extra", true], ["renderRequest", { artifactKey: "wrong", output: { type: "pdf" } }], ["renderRequest", { artifactKey: "duowei:v1:test", output: { type: "png" } }]]) cases.push({ id: "invalid-" + cases.length, body: { ...body, [field]: value } });
cases.push({ id: "missing-signature", body }, { id: "bad-signature", body, signature: "test" });
function signature(value, overrides = {}) {
  const claims = { version: 1, audience: "duowei-background-job", issuedAt: 1, expiresAt: 41024448e5, nonce: "test", taskKey: value.taskKey, bodyDigest: createHash("sha256").update(original.canonicalAutomationJson(value)).digest("base64url"), ...overrides };
  const payload = "duowei-background-job-v1." + Buffer.from(original.canonicalAutomationJson(claims)).toString("base64url");
  return payload + "." + createHmac("sha256", Buffer.alloc(32)).update(payload).digest("base64url");
}
for (const [id, overrides] of [["expired", { expiresAt: 1 }], ["wrong-task", { taskKey: "different" }], ["wrong-body", { bodyDigest: "different" }]]) cases.push({ id, body, signature: signature(body, overrides) });
for (const status of [null, "queued", "processing", "succeeded", "failed"]) cases.push({ id: "valid-" + (status ?? "new"), body, signature: signature(body), existingStatus: status });
for (const item of cases) {
  const store = original.createInMemoryBackgroundJobStore({ now: () => 1e3 });
  if (item.existingStatus) {
    const job = await store.createOrGet(body);
    job.status = item.existingStatus;
    await store.save(job);
  }
  const handler = original.createBackgroundJobHttpHandler({ store, signingSecret: new Uint8Array(32), now: () => 1e3 });
  const response = await handler(new Request("https://test.invalid/background-jobs", { method: "POST", headers: { "content-type": "application/json", "x-duowei-service-signature": item.signature ?? "" }, body: JSON.stringify(item.body) }));
  const result = await response.json();
  if (result.traceId !== response.headers.get("x-duowei-trace-id")) throw new Error("trace mismatch");
  delete result.traceId;
  item.expected = { status: response.status, body: result };
}
await writeFile(new URL("../src/test/resources/background-contracts.json", import.meta.url), JSON.stringify(cases, null, 2) + "\n");
console.log(`Generated ${cases.length} original background contracts.`);
