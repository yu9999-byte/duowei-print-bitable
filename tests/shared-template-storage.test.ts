import assert from "node:assert/strict";
import test from "node:test";
import { createTemplateRepository, type TemplateStorage } from "../src/core/template-repository.ts";
import { createHostTemplateRepository, createSharedTemplateRepository, createSharedTemplateHttpTransport, createSharedTemplateResilientTransport, createSharedTemplateStorage, SharedTemplateAuthRequiredError, type SharedTemplateTransport } from "../src/host/shared-template-storage.ts";
import { planTemplateMigration } from "../src/core/template-migration-plan.ts";

const scope = { baseId: "base-1", tableId: "table-1" };
const template = { pages: [{ id: "p1", elements: [{ id: "text1", type: "text", content: "@客户" }] }], canvasSize: { width: 794, height: 1123 } };

function sharedFixture() {
  const values = new Map<string, any>();
  let writes = 0;
  const transport: SharedTemplateTransport = async (request) => {
    const key = JSON.stringify(request.scope);
    const current = values.get(key);
    if (request.operation === "read") return { value: structuredClone(current ?? null) };
    // Test port implements server atomicity; no await between checking and committing.
    if ((current?.revision ?? null) !== request.expectedRevision) throw new Error("conflict");
    values.set(key, structuredClone(request.value));
    writes++;
    return { committed: true };
  };
  return { transport, values, writes: () => writes };
}

test("two entry repositories share templates, default selection and ordered batch records", async () => {
  const fixture = sharedFixture();
  const detail = createSharedTemplateRepository(fixture.transport);
  const view = createSharedTemplateRepository(fixture.transport);
  const saved = await detail.upsert(scope, template, { id: "invoice", name: "发货单", expectedRevision: null, savedBatchRecordIds: ["r2", "r1"] });
  assert.deepEqual(await view.list(scope), saved);
  const renamed = await view.rename(scope, "invoice", "发货单新版", saved.revision);
  assert.deepEqual(await detail.list(scope), renamed);
  assert.deepEqual(renamed.templates[0].savedBatchRecordIds, ["r2", "r1"]);
  assert.equal(renamed.defaultId, "invoice");
  assert.equal((await view.list({ ...scope, tableId: "other" })).templates.length, 0);
  assert.equal((await view.list({ ...scope, baseId: "other" })).templates.length, 0);
});

test("simultaneous saves from two entry points do not silently overwrite", async () => {
  const fixture = sharedFixture();
  const a = createSharedTemplateRepository(fixture.transport);
  const b = createSharedTemplateRepository(fixture.transport);
  const results = await Promise.allSettled([
    a.upsert(scope, template, { id: "a", name: "A", expectedRevision: null }),
    b.upsert(scope, template, { id: "b", name: "B", expectedRevision: null }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(fixture.writes(), 1);
  assert.equal((await a.list(scope)).templates.length, 1);
});

test("storage failure does not become an empty library or local write fallback", async () => {
  const repository = createSharedTemplateRepository(async () => { throw new Error("offline"); });
  await assert.rejects(repository.list(scope), /offline/);
  await assert.rejects(repository.upsert(scope, template, { id: "a", name: "A", expectedRevision: null }), /offline/);
});

test("shared storage requires explicit server save acknowledgement and CAS", async () => {
  const storage = createSharedTemplateStorage(async () => ({ committed: false }));
  await assert.rejects(storage.setData("key", {}), /原子/);
  await assert.rejects(storage.compareAndSetData!("duowei-print:templates:base:table", {}, null), /未确认/);
  await assert.rejects(storage.compareAndSetData!("arbitrary-key", {}, null), /作用域/);
});

test("read response without value is rejected rather than treated as missing data", async () => {
  await assert.rejects(createSharedTemplateRepository(async () => ({})).list(scope), /缺少/);
});

test("configured shared repository does not touch old bridge on failure; empty config retains old entry", async () => {
  let reads = 0;
  let writes = 0;
  const legacyStorage: TemplateStorage = {
    async getData() { reads++; return null; },
    async setData() { writes++; return true; },
  };
  const legacy = createHostTemplateRepository({ legacyStorage, sharedEndpoint: "" });
  assert.equal((await legacy.list(scope)).templates.length, 0);
  assert.ok(reads > 0);
  reads = 0;
  const shared = createHostTemplateRepository({ legacyStorage, sharedEndpoint: "https://print.example/templates", fetch: async () => new Response("offline", { status: 503 }) });
  await assert.rejects(shared.list(scope), /503/);
  await assert.rejects(shared.upsert(scope, template, { id: "a", name: "A", expectedRevision: null }), /503/);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
});

test("HTTP shared transport uses authenticated no-store requests without exposing credentials in errors", async () => {
  let captured: RequestInit | undefined;
  const transport = createSharedTemplateHttpTransport({ endpoint: "https://print.example/templates", fetch: async (_url, init) => {
    captured = init;
    return new Response("sensitive-token", { status: 409 });
  } });
  await assert.rejects(transport({ operation: "read", scope }), /其他窗口/);
  assert.equal(captured?.credentials, "include");
  assert.equal(captured?.cache, "no-store");
  assert.equal(new Headers(captured?.headers).get("content-type"), "application/x-www-form-urlencoded");
  assert.deepEqual(JSON.parse(new URLSearchParams(String(captured?.body)).get("request")!), { operation: "read", scope });
  for (const endpoint of ["http://print.example", "https://user:secret@print.example", "https://print.example?token=x"]) {
    assert.throws(() => createSharedTemplateHttpTransport({ endpoint }), /HTTPS/);
  }
});

test("resilient transport reads directly after refresh and only uses the bridge for auth recovery", async () => {
  const calls: string[] = [];
  const direct = async () => { calls.push("direct"); return { value: null }; };
  const bridge = async () => { calls.push("bridge"); return { value: "bridge" }; };
  const transport = createSharedTemplateResilientTransport({ direct, bridge });
  assert.deepEqual(await transport({ operation: "read", scope }), { value: null });
  assert.deepEqual(calls, ["direct"]);

  calls.length = 0;
  const auth = createSharedTemplateResilientTransport({
    direct: async () => { throw new SharedTemplateAuthRequiredError(); }, bridge,
  });
  assert.deepEqual(await auth({ operation: "read", scope }), { value: "bridge" });
  assert.deepEqual(calls, ["bridge"]);
});

test("migration inventory preserves old storage and detects metadata and batch conflicts", async () => {
  const oldValues = new Map<string, unknown>();
  let oldWrites = 0;
  const oldStorage: TemplateStorage = {
    async getData<T>(key: string) { return structuredClone(oldValues.get(key)) as T; },
    async setData(key, value) { oldValues.set(key, structuredClone(value)); oldWrites++; return true; },
  };
  const source = createTemplateRepository(oldStorage);
  const saved = await source.upsert(scope, template, { id: "old", name: "旧模板", expectedRevision: null, savedBatchRecordIds: ["r2", "r1"] });
  const snapshot = structuredClone([...oldValues]);
  const shared = sharedFixture();
  const target = createSharedTemplateRepository(shared.transport);
  const first = await planTemplateMigration({ source, target, context: scope });
  assert.equal(first.disposition, "import-into-empty-target");
  assert.deepEqual(first.source, saved);
  assert.equal(oldWrites, 1);
  assert.equal(shared.writes(), 0);
  assert.deepEqual([...oldValues], snapshot);
  await target.upsert(scope, template, { id: "old", name: "另一入口模板", expectedRevision: null, savedBatchRecordIds: ["r1", "r2"] });
  const conflict = await planTemplateMigration({ source, target, context: scope });
  assert.equal(conflict.disposition, "manual-resolution");
  assert.deepEqual(conflict.conflicts, ["old"]);
  assert.deepEqual([...oldValues], snapshot);
});
