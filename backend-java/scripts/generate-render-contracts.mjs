import { build } from "../../miaoda-duowei-automation/node_modules/esbuild/lib/main.js";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const source = fileURLToPath(new URL("../../miaoda-duowei-automation/server/duowei-core/renderer-service.ts", import.meta.url));
const result = await build({ entryPoints: [source], bundle: true, platform: "node", format: "esm", write: false });
const original = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const valid = { artifactKey: "duowei:v1:contract", template: { id: "t", revision: "r1", snapshot: { pages: [] } }, values: {}, output: { type: "pdf", pageLimit: null } };
const cases = [
  { id: "missing-signature", body: valid, signature: "" },
  { id: "missing-request-objects", body: {}, signature: "test" },
  { id: "invalid-output-type", body: { ...valid, output: { type: "jpg", pageLimit: null } }, signature: "test" },
  { id: "invalid-pdf-page-limit", body: { ...valid, output: { type: "pdf", pageLimit: 1 } }, signature: "test" },
  { id: "invalid-png-page-limit", body: { ...valid, output: { type: "png", pageLimit: 2 } }, signature: "test" },
  { id: "missing-artifact-key", body: { ...valid, artifactKey: " " }, signature: "test" },
  { id: "missing-template-id", body: { ...valid, template: { ...valid.template, id: "" } }, signature: "test" },
  { id: "missing-template-revision", body: { ...valid, template: { ...valid.template, revision: "" } }, signature: "test" }
];
const handler = original.createRendererHttpHandler({ signingSecret: new Uint8Array(32).fill(1), render: async () => {
  throw new Error("Invalid request must never render");
} });
for (const item of cases) {
  const response = await handler(new Request("https://test.invalid/render", { method: "POST", headers: { "x-duowei-service-signature": item.signature }, body: JSON.stringify(item.body) }));
  const body = await response.json();
  if (!body.traceId || response.headers.get("x-duowei-trace-id") !== body.traceId) throw new Error("Original trace correlation failed");
  delete body.traceId;
  item.expected = { status: response.status, body };
}
await writeFile(new URL("../src/test/resources/render-contracts.json", import.meta.url), JSON.stringify(cases, null, 2) + "\n");
console.log(`Generated ${cases.length} contract cases from original renderer HTTP handler.`);
