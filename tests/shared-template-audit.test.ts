import assert from "node:assert/strict";
import test from "node:test";
import { createTemplateRepository, templateCollectionKey, type TemplateStorage } from "../src/core/template-repository.ts";
import { createSharedTemplateService, type SharedTemplateStore } from "../src/core/shared-template-service.ts";
import { createSharedTemplateRepository, type SharedTemplateTransport } from "../src/host/shared-template-storage.ts";
import { migrateLegacyTemplates } from "../src/host/shared-template-migration.ts";

const context = { baseId: "audit-base", tableId: "audit-table" };
const template = { pages: [{ id: "p", elements: [] }], canvasSize: { width: 794, height: 1123 } };
const markerKey = `duowei-print:shared-migration:${context.baseId}:${context.tableId}`;
function fixture() {
  const old = new Map<string, unknown>();
  const rows = new Map<string, any>();
  let writes = 0;
  const legacy: TemplateStorage = {
    async getData<T>(key: string) { return structuredClone(old.get(key) ?? null) as T; },
    async setData(key, value) { old.set(key, structuredClone(value)); return true; },
  };
  const store: SharedTemplateStore = {
    async read(scope) { return structuredClone(rows.get(JSON.stringify(scope)) ?? null); },
    async compareAndSet(scope, expected, value) {
      const key = JSON.stringify(scope);
      if ((rows.get(key)?.revision ?? null) !== expected) return false;
      rows.set(key, structuredClone(value));writes++;return true;
    },
  };
  const shared: SharedTemplateTransport = createSharedTemplateService({ store,
    authorize: async () => ({ tenantKey: "audit-tenant", canRead: true, canWrite: true }),
  });
  const source = createTemplateRepository(legacy);
  const seed = () => source.upsert(context, template, { id: "invoice", name: "Original", expectedRevision: null, savedBatchRecordIds: ["r2", "r1"] });
  return { old, rows, legacy, shared, source, seed, writes: () => writes };
}

test("audit: both entries use service validation, share defaults and ordered batches, and reject stale saves", async () => {
  const f=fixture();await f.seed();const originals=structuredClone([...f.old]);
  await migrateLegacyTemplates({...f,context});
  const detail=createSharedTemplateRepository(f.shared), view=createSharedTemplateRepository(f.shared);
  const initial=await detail.list(context);assert.deepEqual(await view.list(context),initial);
  const added=await view.upsert(context,template,{id:"second",name:"Second",expectedRevision:initial.revision});
  const chosen=await detail.setDefault(context,"second",added.revision);
  const batch=await view.setBatchRecords(context,"second",["r5","r3"],chosen.revision);
  const renamed=await detail.rename(context,"second","Renamed",batch.revision);
  await assert.rejects(view.rename(context,"invoice","Stale",initial.revision),/其他窗口/);
  assert.deepEqual(await view.list(context),renamed);
  assert.deepEqual(renamed.templates.find(t=>t.id==="second")?.savedBatchRecordIds,["r5","r3"]);
  const removed=await view.remove(context,"invoice",renamed.revision);
  assert.deepEqual(await detail.list(context),removed);assert.equal(removed.defaultId,"second");
  for(const [key,value] of originals) assert.deepEqual(f.old.get(key),value);
});

test("audit: corrupt backup readback stops migration before shared write", async () => {
  const f=fixture();await f.seed();const originals=structuredClone([...f.old]);
  const read=f.legacy.getData;
  f.legacy.getData=async key=>key.includes(":backup:")&&f.old.has(key)?{}:read(key);
  await assert.rejects(migrateLegacyTemplates({...f,context}),/回读不一致/);
  assert.equal(f.writes(),0);assert.equal(f.old.has(markerKey),false);
  for(const [key,value] of originals) assert.deepEqual(f.old.get(key),value);
});

test("audit: source revision changing before import refuses to copy", async () => {
  const f=fixture();const seeded=await f.seed();const read=f.legacy.getData;
  let changed=false;
  f.legacy.getData=async key=>{
    if(key.startsWith(`${markerKey}:backup:`)&&!changed){
      changed=true;await f.source.rename(context,"invoice","Concurrent",seeded.revision);
    }
    return read(key);
  };
  await assert.rejects(migrateLegacyTemplates({...f,context}),/盘点后发生变化/);
  assert.equal(f.writes(),0);assert.equal(f.old.has(markerKey),false);
  assert.equal((await f.source.list(context)).templates[0].name,"Concurrent");
});

test("audit: source changes during import leave both versions and no success marker", async () => {
  const f=fixture();const seeded=await f.seed();
  const shared:SharedTemplateTransport=async request=>{
    const result=await f.shared(request);
    if(request.operation==="compare-and-set") await f.source.rename(context,"invoice","Concurrent",seeded.revision);
    return result;
  };
  await assert.rejects(migrateLegacyTemplates({...f,shared,context}),/源版本不一致/);
  assert.equal(f.old.has(markerKey),false);assert.equal(f.writes(),1);
  assert.equal((await f.source.list(context)).templates[0].name,"Concurrent");
  assert.equal((await createSharedTemplateRepository(f.shared).list(context)).templates[0].name,"Original");
});

test("audit: failed success marker can retry without rewriting imported collection", async () => {
  const f=fixture();await f.seed();const write=f.legacy.setData;
  f.legacy.setData=async (key,value)=>key===markerKey?false:write(key,value);
  await assert.rejects(migrateLegacyTemplates({...f,context}),/迁移确认未保存/);
  assert.equal(f.writes(),1);assert.equal(f.old.has(markerKey),false);
  f.legacy.setData=write;await migrateLegacyTemplates({...f,context});
  assert.equal(f.writes(),1);assert.equal(f.old.has(markerKey),true);
  const backup=[...f.old.keys()].find(key=>key.startsWith(`${markerKey}:backup:`))!;
  const snapshot=f.old.get(backup) as Record<string,unknown>;
  assert.deepEqual(snapshot[templateCollectionKey(context.baseId,context.tableId)],f.old.get(templateCollectionKey(context.baseId,context.tableId)));
});

test("audit: disconnected shared service preserves legacy and successful retry imports it", async () => {
  const f=fixture();await f.seed();const originals=structuredClone([...f.old]);
  await assert.rejects(migrateLegacyTemplates({...f,shared:async()=>{throw new Error("offline");},context}),/offline/);
  assert.equal(f.writes(),0);assert.equal(f.old.has(markerKey),false);
  for(const [key,value] of originals) assert.deepEqual(f.old.get(key),value);
  await migrateLegacyTemplates({...f,context});assert.equal(f.writes(),1);
  assert.deepEqual(await createSharedTemplateRepository(f.shared).list(context),await f.source.list(context));
});
