import assert from "node:assert/strict";
import test from "node:test";
import { createSharedTemplateService, SharedTemplateServiceError, type SharedTemplateStore } from "../src/core/shared-template-service.ts";
import { createSharedTemplateRepository } from "../src/host/shared-template-storage.ts";

const scope = { baseId: "base", tableId: "table" };
const template = { pages: [], canvasSize: { width: 794, height: 1123 } };

function fixture() {
  const rows = new Map<string, any>();
  let writes = 0;
  const store: SharedTemplateStore = {
    async read(key) { return structuredClone(rows.get(JSON.stringify(key)) ?? null); },
    async compareAndSet(key, expected, value) {
      const id = JSON.stringify(key);
      if ((rows.get(id)?.revision ?? null) !== expected) return false;
      rows.set(id, structuredClone(value)); writes++; return true;
    },
  };
  const forTenant = (tenantKey: string, canWrite = true) => createSharedTemplateService({
    store, authorize: async () => ({ tenantKey, canRead: true, canWrite }),
  });
  return { forTenant, rows, writes: () => writes };
}

test("server derives tenant from session; identical base/table from another tenant cannot read data", async () => {
  const f = fixture();
  const a = createSharedTemplateRepository(f.forTenant("tenant-a"));
  const b = createSharedTemplateRepository(f.forTenant("tenant-b"));
  await a.upsert(scope, template, { id: "one", name: "合同", expectedRevision: null });
  assert.equal((await b.list(scope)).templates.length, 0);
  const service = f.forTenant("tenant-a");
  await assert.rejects(service({ operation: "read", scope: { ...scope, tenantKey: "tenant-b" } }), { status: 400 });
  await assert.rejects(service({ operation: "read", scope, tenantKey: "tenant-b" }), { status: 400 });
});

test("read-only users can read but cannot rename, delete or change defaults", async () => {
  const f = fixture();
  const editor = createSharedTemplateRepository(f.forTenant("tenant-a"));
  const saved = await editor.upsert(scope, template, { id: "one", name: "合同", expectedRevision: null });
  const reader = createSharedTemplateRepository(f.forTenant("tenant-a", false));
  assert.deepEqual(await reader.list(scope), saved);
  for (const action of [() => reader.rename(scope, "one", "覆盖", saved.revision), () => reader.remove(scope, "one", saved.revision), () => reader.setDefault(scope, "one", saved.revision)]) {
    await assert.rejects(action(), { status: 403 });
  }
  assert.equal(f.writes(), 1);
});

test("service rejects unauthenticated requests before accessing storage", async () => {
  let accessed = false;
  const service = createSharedTemplateService({
    authorize: async () => { throw new SharedTemplateServiceError(401, "连接已过期"); },
    store: { async read() { accessed = true; return null; }, async compareAndSet() { accessed = true; return true; } },
  });
  await assert.rejects(service({ operation: "read", scope }), { status: 401 });
  assert.equal(accessed, false);
});

test("service validates envelope scope, checksums, runtime values and requires expected revision", async () => {
  const f = fixture();
  const service = f.forTenant("tenant-a");
  const repo = createSharedTemplateRepository(service);
  await repo.upsert(scope, template, { id: "one", name: "合同", expectedRevision: null });
  const original = [...f.rows.values()][0];
  const corruptions = [
    { ...original, baseId: "other" },
    { ...original, revision: "tampered" },
    { ...original, templates: [{ ...original.templates[0], template: { ...template, accessToken: "secret" } }] },
  ];
  for (const value of corruptions) await assert.rejects(service({ operation: "compare-and-set", scope, value, expectedRevision: original.revision }), { status: 400 });
  await assert.rejects(service({ operation: "compare-and-set", scope, value: original }), { status: 400 });
  assert.equal(f.writes(), 1);
});
