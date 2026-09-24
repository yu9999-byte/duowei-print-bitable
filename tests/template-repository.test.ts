import assert from "node:assert/strict";
import test from "node:test";
import {
  createTemplateRepository,
  legacyTemplateStorageKey,
  loadTemplateForUse,
  templateStorageKey,
  type TemplateStorage,
} from "../src/core/template-repository.ts";

function template(value = "不应持久化的客户甲", titleX = 0) {
  return {
    pages: [{
      id: "page-1",
      elements: [
        { id: "title", type: "text", content: "客户：@客户", x: titleX },
        { id: "lines", type: "table", variable: "@明细", data: [{ 产品: value }] },
      ],
    }],
    canvasSize: { width: 794, height: 1123 },
    testData: { 客户: value },
    variables: { 客户: value },
  };
}

function memoryStorage() {
  const values = new Map<string, unknown>();
  const writes: Array<[string, unknown]> = [];
  const storage: TemplateStorage = {
    async getData<T>(key: string) { return values.get(key) as T | undefined; },
    async setData<T>(key: string, value: T) {
      writes.push([key, structuredClone(value)]);
      values.set(key, structuredClone(value));
      return true;
    },
  };
  return { storage, values, writes };
}

test("SPEC-SAVE-01: one versioned active template is isolated by tableId and contains no record values", async () => {
  const fixture = memoryStorage();
  const repository = createTemplateRepository(fixture.storage, () => new Date("2026-09-21T12:00:00.000Z"));

  const saved = await repository.save({ baseId: "base-orders", tableId: "table-orders" }, template(), { expectedChecksum: null });
  assert.equal(fixture.writes[0][0], templateStorageKey("base-orders", "table-orders"));
  const envelope = fixture.writes[0][1] as Record<string, unknown>;
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.engine, "vue-print-designer");
  assert.equal(envelope.engineVersion, "1.7.39");
  assert.equal(envelope.tableId, "table-orders");
  assert.equal(envelope.updatedAt, "2026-09-21T12:00:00.000Z");
  assert.equal(typeof envelope.checksum, "string");
  assert.ok(saved.checksum.length > 0);
  assert.ok(!JSON.stringify(envelope).includes("不应持久化的客户甲"));
  assert.deepEqual(
    ((saved.template as any).pages[0].elements[1]).data,
    [],
  );

  assert.equal(await repository.load({ baseId: "base-orders", tableId: "table-other" }), null);
  const loaded = await repository.load({ baseId: "base-orders", tableId: "table-orders" });
  assert.deepEqual(loaded, saved);
});

test("SPEC-SAVE-02: checksum mismatch rejects stale-window overwrite", async () => {
  const fixture = memoryStorage();
  const repository = createTemplateRepository(fixture.storage);
  const context = { baseId: "base-orders", tableId: "table-orders" };
  const first = await repository.save(context, template("第一版", 10), { expectedChecksum: null });
  await repository.save(context, template("第二版", 20), { expectedChecksum: first.checksum });

  await assert.rejects(
    () => repository.save(context, template("过期窗口", 30), { expectedChecksum: first.checksum }),
    { message: "活动模板已被其他窗口更新，请重新加载后再保存" },
  );
  assert.equal(fixture.writes.length, 2);
});

test("SPEC-SAVE-01: the same tableId remains isolated across different Bases", async () => {
  const fixture = memoryStorage();
  const repository = createTemplateRepository(fixture.storage);
  const saved = await repository.save(
    { baseId: "base-a", tableId: "table-orders" },
    template(),
    { expectedChecksum: null },
  );

  assert.equal(await repository.load({ baseId: "base-b", tableId: "table-orders" }), null);
  assert.deepEqual(
    await repository.load({ baseId: "base-a", tableId: "table-orders" }),
    saved,
  );
});

test("SPEC-SAVE-01: a legacy table-only key is read but the next save writes the Base-scoped key", async () => {
  const fixture = memoryStorage();
  const repository = createTemplateRepository(fixture.storage);
  const context = { baseId: "base-orders", tableId: "table-orders" };
  const first = await repository.save(context, template("旧模板", 10), { expectedChecksum: null });
  const currentKey = templateStorageKey(context.baseId, context.tableId);
  const legacyKey = legacyTemplateStorageKey(context.tableId);
  const legacyEnvelope = structuredClone(fixture.values.get(currentKey)) as Record<string, unknown>;
  delete legacyEnvelope.baseId;
  fixture.values.delete(currentKey);
  fixture.values.set(legacyKey, legacyEnvelope);
  fixture.writes.length = 0;

  assert.deepEqual(await repository.load(context), first);
  await repository.save(context, template("迁移后模板", 20), { expectedChecksum: first.checksum });

  assert.equal(fixture.writes.length, 1);
  assert.equal(fixture.writes[0][0], currentKey);
  assert.deepEqual(fixture.values.get(legacyKey), legacyEnvelope);
});

test("SPEC-SAVE-02: corrupted or future stored data fails without being overwritten", async () => {
  const fixture = memoryStorage();
  const key = templateStorageKey("base-orders", "table-orders");
  fixture.values.set(key, {
    schemaVersion: 99,
    engine: "vue-print-designer",
    engineVersion: "1.7.39",
    tableId: "table-orders",
    updatedAt: "2026-09-21T12:00:00.000Z",
    checksum: "future",
    template: template(),
  });
  const repository = createTemplateRepository(fixture.storage);

  await assert.rejects(
    () => repository.load({ baseId: "base-orders", tableId: "table-orders" }),
    { message: "活动模板版本过新，当前版本无法安全读取" },
  );
  assert.equal(fixture.writes.length, 0);
});

test("SPEC-SRC-02/DES-02: an unreadable stored template falls back without blocking current data", async () => {
  const fixture = memoryStorage();
  const key = templateStorageKey("base-orders", "table-orders");
  const legacy = {
    pages: [{ id: "legacy-page", elements: [] }],
    canvasSize: { width: 794, height: 1123 },
  };
  fixture.values.set(key, structuredClone(legacy));
  const repository = createTemplateRepository(fixture.storage);

  const outcome = await loadTemplateForUse(repository, { baseId: "base-orders", tableId: "table-orders" });

  assert.equal(outcome.stored, null);
  assert.equal(outcome.canSave, false);
  assert.equal(outcome.warning, "活动模板存储版本无效");
  assert.deepEqual(fixture.values.get(key), legacy);
  assert.equal(fixture.writes.length, 0);
});

test("SPEC-SRC-02: a readable stored template remains editable", async () => {
  const fixture = memoryStorage();
  const repository = createTemplateRepository(fixture.storage);
  const saved = await repository.save({ baseId: "base-orders", tableId: "table-orders" }, template(), { expectedChecksum: null });

  const outcome = await loadTemplateForUse(repository, { baseId: "base-orders", tableId: "table-orders" });

  assert.deepEqual(outcome, { stored: saved, warning: null, canSave: true });
});

test("SPEC-SEC-01: stored runtime record data is rejected even with a matching legacy checksum", async () => {
  const fixture = memoryStorage();
  const repository = createTemplateRepository(fixture.storage);
  const context = { baseId: "base-orders", tableId: "table-orders" };
  const saved = await repository.save(context, template(), { expectedChecksum: null });
  const key = templateStorageKey("base-orders", "table-orders");
  const envelope = fixture.values.get(key) as Record<string, any>;
  envelope.template.testData = { 客户: "不应读取" };
  fixture.values.set(key, envelope);

  await assert.rejects(
    () => repository.load(context),
    { message: "活动模板包含不允许持久化的运行数据" },
  );
  assert.equal(fixture.writes.length, 1);
  assert.ok(saved.checksum.length > 0);
});

test("SPEC-SAVE-01: a failed bridge write is reported as an unsaved template", async () => {
  const storage: TemplateStorage = {
    async getData() { return undefined; },
    async setData() { return false; },
  };
  const repository = createTemplateRepository(storage);
  await assert.rejects(
    () => repository.save({ baseId: "base-orders", tableId: "table-orders" }, template(), { expectedChecksum: null }),
    { message: "活动模板保存失败，飞书存储未确认写入" },
  );
});
