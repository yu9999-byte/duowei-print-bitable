import assert from "node:assert/strict";
import test from "node:test";
import {
  createTemplateRepository,
  legacyTemplateStorageKey,
  loadTemplateForUse,
  templateStorageKey,
  templateCollectionKey,
  type TemplateStorage,
} from "../src/core/template-repository.ts";
import {
  getBatchLayoutMode,
  setBatchLayoutMode,
} from "../src/components/template-layout-choice.ts";

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

test("SPEC-SAVE-01: versioned collection is isolated by tableId and contains no record values", async () => {
  const fixture = memoryStorage();
  const repository = createTemplateRepository(fixture.storage, () => new Date("2026-09-21T12:00:00.000Z"));

  const saved = await repository.save({ baseId: "base-orders", tableId: "table-orders" }, template(), { expectedChecksum: null });
  assert.equal(fixture.writes[0][0], templateCollectionKey("base-orders", "table-orders"));
  const envelope = fixture.writes[0][1] as Record<string, unknown>;
  assert.equal(envelope.schemaVersion, 2);
  assert.equal(envelope.engine, "vue-print-designer");
  assert.equal(envelope.engineVersion, "1.7.39");
  assert.equal(envelope.tableId, "table-orders");
  assert.equal((envelope.templates as any[])[0].updatedAt, "2026-09-21T12:00:00.000Z");
  assert.equal(typeof envelope.revision, "string");
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

test("SPEC-UX-06/SPEC-SAVE-01: two independent templates persist with one default", async () => {
  const fixture = memoryStorage();
  const repository = createTemplateRepository(fixture.storage);
  const context = { baseId: "base-orders", tableId: "table-orders" };
  const first = await repository.upsert(context, template("first"), {
    id: "first", name: "发货单", expectedRevision: null,
  });
  const second = await repository.upsert(context, template("second", 100), {
    id: "second", name: "对账单", expectedRevision: first.revision,
  });
  assert.deepEqual(second.templates.map((item) => item.name), ["发货单", "对账单"]);
  assert.equal(second.defaultId, "first");
  const changed = await repository.setDefault(context, "second", second.revision);
  assert.equal((await repository.list(context)).defaultId, "second");
  await assert.rejects(() => repository.remove(context, "second", changed.revision), /先设置其他默认模板/);
  const removed = await repository.remove(context, "first", changed.revision);
  assert.equal(removed.templates.length, 1);
  const empty = await repository.remove(context, "second", removed.revision);
  assert.deepEqual(empty.templates, []);
  assert.equal(empty.defaultId, null);
});

test("SPEC-SAVE-05: two members using the same Base bridge scope observe one template collection", async () => {
  const fixture = memoryStorage();
  const memberA = createTemplateRepository(fixture.storage);
  const memberB = createTemplateRepository(fixture.storage);
  const sharedContext = { baseId: "base-orders", tableId: "table-orders" };

  const createdByA = await memberA.upsert(sharedContext, template("member-a"), {
    id: "shared", name: "共享发货单", expectedRevision: null,
  });
  const observedByB = await memberB.list(sharedContext);

  assert.deepEqual(observedByB, createdByA);
  assert.equal(observedByB.templates[0].name, "共享发货单");
  assert.deepEqual(
    await memberB.list({ baseId: "base-orders", tableId: "table-other" }),
    { templates: [], defaultId: null, revision: null },
  );
});

test("SPEC-BATCH-10: changing one template batch layout keeps its id, count, and sibling unchanged", async () => {
  const fixture = memoryStorage();
  const repository = createTemplateRepository(fixture.storage);
  const context = { baseId: "base-orders", tableId: "table-orders" };
  const first = await repository.upsert(context, template("first"), {
    id: "first", name: "发货单", expectedRevision: null,
  });
  const second = await repository.upsert(context, template("second", 100), {
    id: "second", name: "对账单", expectedRevision: first.revision,
  });
  const siblingBefore = second.templates.find((item) => item.id === "second")!;
  const current = second.templates.find((item) => item.id === "first")!;
  const changed = await repository.upsert(context, setBatchLayoutMode(current.template, "continuous"), {
    id: current.id, name: current.name, expectedRevision: second.revision,
  });

  assert.equal(changed.templates.length, 2);
  assert.deepEqual(changed.templates.map((item) => item.id), ["first", "second"]);
  assert.equal(getBatchLayoutMode(changed.templates.find((item) => item.id === "first")!.template), "continuous");
  assert.deepEqual(changed.templates.find((item) => item.id === "second"), siblingBefore);
});

test("SPEC-SAVE-01/04: v1 stays untouched until a valid v2 mutation, stale revision cannot overwrite", async () => {
  const fixture = memoryStorage();
  const repository = createTemplateRepository(fixture.storage);
  const context = { baseId: "base-orders", tableId: "table-orders" };
  // A legacy writer supplies the old envelope; v2 must read it without writing.
  const legacy = await repository.save(context, template("旧"), { expectedChecksum: null });
  const v2key = templateCollectionKey(context.baseId, context.tableId);
  const v1key = templateStorageKey(context.baseId, context.tableId);
  const v2 = fixture.values.get(v2key);
  fixture.values.delete(v2key);
  fixture.values.set(v1key, {
    schemaVersion: 1, engine: "vue-print-designer", engineVersion: "1.7.39",
    baseId: context.baseId, tableId: context.tableId, updatedAt: legacy.updatedAt,
    checksum: legacy.checksum, template: legacy.template,
  });
  fixture.writes.length = 0;
  const loaded = await repository.list(context);
  assert.equal(loaded.templates.length, 1);
  assert.equal(fixture.writes.length, 0);
  const migrated = await repository.upsert(context, template("新"), {
    id: "new", name: "新模板", expectedRevision: loaded.revision,
  });
  assert.equal(migrated.templates.length, 2);
  assert.deepEqual(fixture.values.get(v1key), {
    schemaVersion: 1, engine: "vue-print-designer", engineVersion: "1.7.39",
    baseId: context.baseId, tableId: context.tableId, updatedAt: legacy.updatedAt,
    checksum: legacy.checksum, template: legacy.template,
  });
  await assert.rejects(() => repository.rename(context, "new", "覆盖", loaded.revision), /其他窗口更新/);
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

test("SPEC-SAVE-01: Feishu bridge returns an empty object for every missing key", async () => {
  const fixture = memoryStorage();
  const storage: TemplateStorage = {
    async getData<T>(key: string) {
      return (fixture.values.has(key) ? fixture.values.get(key) : {}) as T;
    },
    setData: fixture.storage.setData,
  };
  const repository = createTemplateRepository(storage);
  const context = { baseId: "base-orders", tableId: "table-orders" };

  assert.deepEqual(await repository.list(context), { templates: [], defaultId: null, revision: null });
  const saved = await repository.upsert(context, template(), {
    id: "first", name: "首个模板", expectedRevision: null,
  });
  assert.equal(saved.templates.length, 1);
  assert.equal((await repository.list(context)).defaultId, "first");
  assert.equal(fixture.writes.length, 1);
});

test("SPEC-SAVE-02: a nonempty unrecognized collection remains read-only", async () => {
  const fixture = memoryStorage();
  const context = { baseId: "base-orders", tableId: "table-orders" };
  fixture.values.set(templateCollectionKey(context.baseId, context.tableId), { unexpected: true });
  const repository = createTemplateRepository(fixture.storage);

  await assert.rejects(() => repository.list(context), /模板集合存储格式无效/);
  assert.equal(fixture.writes.length, 0);
});

test("SPEC-SAVE-01: a legacy table-only key is read but the next save writes the Base-scoped key", async () => {
  const fixture = memoryStorage();
  const repository = createTemplateRepository(fixture.storage);
  const context = { baseId: "base-orders", tableId: "table-orders" };
  const first = await repository.save(context, template("旧模板", 10), { expectedChecksum: null });
  const currentKey = templateCollectionKey(context.baseId, context.tableId);
  const legacyKey = legacyTemplateStorageKey(context.tableId);
  const legacyEnvelope = {
    schemaVersion: 1, engine: "vue-print-designer", engineVersion: "1.7.39",
    tableId: context.tableId, updatedAt: first.updatedAt,
    checksum: first.checksum, template: first.template,
  };
  fixture.values.delete(currentKey);
  fixture.values.set(legacyKey, legacyEnvelope);
  fixture.writes.length = 0;

  assert.equal((await repository.load(context))?.checksum, first.checksum);
  await repository.save(context, template("迁移后模板", 20), { expectedChecksum: first.checksum });

  assert.equal(fixture.writes.length, 1);
  assert.equal(fixture.writes[0][0], currentKey);
  assert.deepEqual(fixture.values.get(legacyKey), legacyEnvelope);
});

test("SPEC-SAVE-02: corrupted or future stored data fails without being overwritten", async () => {
  const fixture = memoryStorage();
  const key = templateCollectionKey("base-orders", "table-orders");
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
    { message: "模板集合版本过新，当前版本无法安全读取" },
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
  const key = templateCollectionKey("base-orders", "table-orders");
  const envelope = fixture.values.get(key) as Record<string, any>;
  envelope.templates[0].template.testData = { 客户: "不应读取" };
  fixture.values.set(key, envelope);

  await assert.rejects(
    () => repository.load(context),
    { message: "活动模板包含不允许持久化的运行数据" },
  );
  assert.equal(fixture.writes.length, 1);
  assert.ok(saved.checksum.length > 0);
});

test("SPEC-SEC-01: saving strips nested runtime records and credential-shaped values", async () => {
  const fixture = memoryStorage();
  const repository = createTemplateRepository(fixture.storage);
  const secret = "SECURITY-SENTINEL-DO-NOT-PERSIST";
  const unsafe = {
    ...template(secret),
    runtimeValues: { 客户: secret },
    recordData: { recordId: "rec-secret", values: { 客户: secret } },
    recordIds: ["rec-secret"],
    documents: [{ recordId: "rec-secret", values: { 客户: secret } }],
    accessToken: secret,
    nested: {
      authorization: `Bearer ${secret}`,
      tenant_access_token: secret,
      refreshToken: secret,
    },
  };

  const saved = await repository.save(
    { baseId: "base-orders", tableId: "table-orders" },
    unsafe,
    { expectedChecksum: null },
  );
  const serialized = JSON.stringify(fixture.writes[0][1]);

  assert.ok(!serialized.includes(secret));
  assert.ok(!serialized.includes("rec-secret"));
  assert.deepEqual(Object.keys(saved.template).sort(), ["canvasSize", "nested", "pages"]);
  assert.deepEqual(saved.template.nested, {});
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
