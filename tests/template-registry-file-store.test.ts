import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJsonFileTemplateRegistryStore } from "../src/automation/template-registry-file-store.ts";
import {
  createAuthenticatedTemplateRegistry,
  signRegistryWriteRequest,
  type RegistryWriteIdentity,
  type RegistryWriteRequest,
} from "../src/automation/template-registry-service.ts";

const secret = new TextEncoder().encode("persistent-registry-test-secret-32-bytes-minimum");
const identity: RegistryWriteIdentity = {
  tenantKey: "tenant-a",
  baseToken: "base-a",
  tableId: "table-a",
  principalId: "user-a",
  canWrite: true,
};
const body: RegistryWriteRequest = {
  scope: {
    tenantKey: identity.tenantKey,
    baseToken: identity.baseToken,
    tableId: identity.tableId,
  },
  template: {
    id: "template-a",
    revision: "revision-1",
    name: "发货单",
    snapshot: {
      canvasSize: { width: 794, height: 1123 },
      pages: [{ id: "page-1", elements: [] }],
    },
    referencedFieldIds: ["fld-order"],
  },
};

test("IT-AUTO-07: template registry survives a service restart through its file store", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "duowei-registry-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "registry.json");
  const first = createAuthenticatedTemplateRegistry({
    signingSecret: secret,
    store: createJsonFileTemplateRegistryStore({ path }),
  });
  await first.upsert(body, await signRegistryWriteRequest(body, identity, secret));

  const second = createAuthenticatedTemplateRegistry({
    signingSecret: secret,
    store: createJsonFileTemplateRegistryStore({ path }),
  });
  const listed = await second.list(body.scope);
  const restored = await second.get(body.scope, { id: "template-a", revision: "revision-1" });
  assert.equal(listed.length, 1);
  assert.equal(restored?.name, "发货单");
  assert.deepEqual(restored?.referencedFieldIds, ["fld-order"]);
  assert.doesNotMatch(await readFile(path, "utf8"), /persistent-registry-test-secret/);
});

test("IT-AUTO-07/08: corrupt persistent state fails closed and is not overwritten", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "duowei-registry-corrupt-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "registry.json");
  await writeFile(path, "{not-json", "utf8");
  const registry = createAuthenticatedTemplateRegistry({
    signingSecret: secret,
    store: createJsonFileTemplateRegistryStore({ path }),
  });

  await assert.rejects(() => registry.list(body.scope), /持久化|JSON|损坏/);
  assert.equal(await readFile(path, "utf8"), "{not-json");
});

test("IT-AUTO-07: concurrent writes are serialized without losing templates", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "duowei-registry-concurrent-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "registry.json");
  const registry = createAuthenticatedTemplateRegistry({
    signingSecret: secret,
    store: createJsonFileTemplateRegistryStore({ path }),
  });
  const secondBody: RegistryWriteRequest = {
    ...body,
    template: { ...body.template, id: "template-b", name: "拣货单" },
  };

  await Promise.all([
    registry.upsert(body, await signRegistryWriteRequest(body, identity, secret)),
    registry.upsert(secondBody, await signRegistryWriteRequest(secondBody, identity, secret)),
  ]);
  assert.deepEqual((await registry.list(body.scope)).map((item) => item.name).sort(), ["发货单", "拣货单"]);
});

test("IT-AUTO-07: persistent registry keeps only the latest revision for one template id", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "duowei-registry-revision-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "registry.json");
  const registry = createAuthenticatedTemplateRegistry({
    signingSecret: secret,
    store: createJsonFileTemplateRegistryStore({ path }),
  });
  const secondBody: RegistryWriteRequest = {
    ...body,
    template: { ...body.template, revision: "revision-2", name: "发货单新版" },
  };

  await registry.upsert(body, await signRegistryWriteRequest(body, identity, secret));
  await registry.upsert(secondBody, await signRegistryWriteRequest(secondBody, identity, secret));

  assert.deepEqual((await registry.list(body.scope)).map((item) => [item.name, item.revision]), [
    ["发货单新版", "revision-2"],
  ]);
  assert.equal(await registry.get(body.scope, { id: "template-a", revision: "revision-1" }), null);
  assert.equal((await registry.get(body.scope, { id: "template-a", revision: "revision-2" }))?.name, "发货单新版");
});

test("IT-AUTO-07: a deleted template stays absent after persistent registry restart", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "duowei-registry-deleted-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "registry.json");
  const first = createAuthenticatedTemplateRegistry({
    signingSecret: secret,
    store: createJsonFileTemplateRegistryStore({ path }),
  });
  const removed: RegistryWriteRequest = {
    ...body,
    template: { ...body.template, status: "deleted" },
  };
  await first.upsert(body, await signRegistryWriteRequest(body, identity, secret));
  await first.upsert(removed, await signRegistryWriteRequest(removed, identity, secret));

  const second = createAuthenticatedTemplateRegistry({
    signingSecret: secret,
    store: createJsonFileTemplateRegistryStore({ path }),
  });
  assert.deepEqual(await second.list(body.scope), []);
  assert.equal((await second.get(body.scope, {
    id: body.template.id,
    revision: body.template.revision,
  }))?.status, "deleted");
});
