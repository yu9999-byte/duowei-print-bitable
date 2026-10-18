import { build } from "../../miaoda-duowei-automation/node_modules/esbuild/lib/main.js";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const source = fileURLToPath(new URL("../../miaoda-duowei-automation/server/duowei-core/feishu-app-ticket.ts", import.meta.url));
const built = await build({ entryPoints: [source], bundle: true, platform: "node", format: "esm", write: false });
const original = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
const valid = { token: "local-test", event: { type: "app_ticket", app_id: "cli_localtest", app_ticket: " ticket-value " } };
const cases = [
  { id: "null", body: null },
  { id: "array", body: [] },
  { id: "number", body: 42 },
  { id: "encrypted", body: { encrypt: "", token: "local-test" } },
  { id: "missing-token", body: {} },
  { id: "wrong-token", body: { token: "other" } },
  { id: "numeric-token", body: { token: 123 } },
  { id: "challenge", body: { token: "local-test", type: "url_verification", challenge: " spaced " } },
  { id: "empty-challenge", body: { token: "local-test", type: "url_verification", challenge: "" } },
  { id: "ignored-event", body: { token: "local-test", event: { type: "other" } } },
  { id: "array-event", body: { token: "local-test", event: [] } },
  { id: "wrong-app", body: { ...valid, event: { ...valid.event, app_id: "cli_other" } } },
  { id: "empty-ticket", body: { ...valid, event: { ...valid.event, app_ticket: " " } } },
  { id: "numeric-ticket", body: { ...valid, event: { ...valid.event, app_ticket: 12 } } },
  { id: "unicode-blank-ticket", body: { ...valid, event: { ...valid.event, app_ticket: " \uFEFF" } } },
  { id: "unicode-padded-ticket", body: { ...valid, event: { ...valid.event, app_ticket: " ticket-value\uFEFF" } } },
  { id: "valid-ticket", body: valid },
  { id: "duplicate-ticket", body: valid }
];
let saved = [];
const handler = original.createAppTicketEventHandler({ appId: "cli_localtest", verificationToken: "local-test", now: () => 1e3, store: { get: async () => null, save: async (value) => {
  saved.push(value.ticket);
} } });
for (const item of cases) {
  saved = [];
  const response = await handler(new Request("https://test.invalid/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(item.body) }));
  item.expected = { status: response.status, body: await response.json(), savedTickets: saved };
}
await writeFile(new URL("../src/test/resources/event-contracts.json", import.meta.url), JSON.stringify(cases, null, 2) + "\n");
console.log(`Generated ${cases.length} original event contracts.`);
