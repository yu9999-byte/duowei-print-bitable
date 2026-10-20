import assert from "node:assert/strict";
import test from "node:test";
import { createTemplateRepository, templateCollectionKey, templateStorageKey, type TemplateStorage } from "../src/core/template-repository.ts";
import { createSharedTemplateRepository, type SharedTemplateTransport } from "../src/host/shared-template-storage.ts";
import { migrateLegacyTemplates } from "../src/host/shared-template-migration.ts";

const context = { baseId: "base", tableId: "table" };
const template = { pages: [{ id: "page", elements: [] }], canvasSize: { width: 794, height: 1123 } };
function fixture() {
  const old = new Map<string, unknown>();
  let value: any = null;
  let writes = 0;
  const legacy: TemplateStorage = {
    async getData<T>(key: string) { return structuredClone(old.get(key) ?? null) as T; },
    async setData(key, next) { old.set(key, structuredClone(next)); return true; },
  };
  const shared: SharedTemplateTransport = async request => {
    if (request.operation === "read") return { value: structuredClone(value) };
    if ((value?.revision ?? null) !== request.expectedRevision) throw new Error("conflict");
    value = structuredClone(request.value); writes++; return { committed: true };
  };
  return { legacy, shared, old, writes: () => writes };
}
test("migration copies full collection, preserves original keys and retries without overwriting later shared edits", async () => {
  const f = fixture();
  const source = createTemplateRepository(f.legacy);
  const saved = await source.upsert(context, template, { id: "invoice", name: "旧模板", expectedRevision: null, savedBatchRecordIds: ["r2", "r1"] });
  const before = structuredClone([...f.old]);
  await migrateLegacyTemplates({ ...f, context });
  for (const [key, value] of before) assert.deepEqual(f.old.get(key), value);
  const target = createSharedTemplateRepository(f.shared);
  assert.deepEqual(await target.list(context), saved);
  assert.ok([...f.old.keys()].some(key => key.includes(":backup:")));
  await target.rename(context, "invoice", "共享新版", saved.revision);
  await migrateLegacyTemplates({ ...f, context });
  assert.equal((await target.list(context)).templates[0].name, "共享新版");
  assert.equal(f.writes(), 2);
  await source.rename(context, "invoice", "旧窗口改动", saved.revision);
  await assert.rejects(migrateLegacyTemplates({ ...f, context }), /迁移后发生变化/);
});
test("different existing target refuses overwrite and leaves old templates intact", async () => {
  const f = fixture();
  await createTemplateRepository(f.legacy).upsert(context, template, { id: "old", name: "旧模板", expectedRevision: null });
  await createSharedTemplateRepository(f.shared).upsert(context, template, { id: "new", name: "新模板", expectedRevision: null });
  await assert.rejects(migrateLegacyTemplates({ ...f, context }), /不同模板/);
  assert.equal(f.writes(), 1);
  assert.equal((await createTemplateRepository(f.legacy).list(context)).templates[0].id, "old");
});
test("failed backup acknowledgement prevents any shared write", async () => {
  const f = fixture();
  f.legacy.setData = async () => false;
  await assert.rejects(migrateLegacyTemplates({ ...f, context }), /备份未确认/);
  assert.equal(f.writes(), 0);
});
test("v1 migration preserves the original envelope and converts to a readable shared collection", async () => {
  const f = fixture();
  const saved = await createTemplateRepository(f.legacy).upsert(context, template, { id: "v1", name: "旧", expectedRevision: null });
  const item = saved.templates[0];
  f.old.delete(templateCollectionKey(context.baseId, context.tableId));
  const key = templateStorageKey(context.baseId, context.tableId);
  const envelope = { schemaVersion: 1, engine: "vue-print-designer", engineVersion: "1.7.39", ...context, template: item.template, checksum: item.checksum, updatedAt: item.updatedAt };
  f.old.set(key, envelope);
  await migrateLegacyTemplates({ ...f, context });
  const migrated = await createSharedTemplateRepository(f.shared).list(context);
  assert.equal(migrated.templates[0].id, "migrated-v1");
  assert.deepEqual(migrated.templates[0].template, item.template);
  assert.deepEqual(f.old.get(key), envelope);
  await migrateLegacyTemplates({ ...f, context });
  assert.equal(f.writes(), 1);
});
