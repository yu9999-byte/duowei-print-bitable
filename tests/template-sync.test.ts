import assert from "node:assert/strict";
import test from "node:test";
import { fieldDataSourceId } from "../src/core/data-sources.ts";
import {
  createRecordViewTemplateSync,
  type TemplateSyncScope,
} from "../src/automation/template-sync.ts";
import type { StoredTemplate } from "../src/core/template-repository.ts";

const scope: TemplateSyncScope = {
  baseToken: "base-a",
  tableId: "table-a",
};

function stored(): StoredTemplate {
  return {
    id: "template-a",
    name: "发货单",
    checksum: "fnv1a32:12345678",
    updatedAt: "2026-10-12T08:00:00.000Z",
    template: {
      canvasSize: { width: 600, height: 800 },
      ext: {
        availableVariables: [{
          id: "__duowei_fields",
          label: "字段",
          children: [
            { id: fieldDataSourceId("field-a"), label: "订单编号" },
            { id: fieldDataSourceId("field-unused"), label: "未使用字段" },
          ],
        }],
      },
      pages: [{ elements: [
        { type: "text", content: `订单：@${fieldDataSourceId("field-a")}` },
        { type: "table", variable: `@${fieldDataSourceId("field-lines")}` },
        { type: "text", content: `重复：@${fieldDataSourceId("field-a")}` },
      ] }],
    },
  };
}

test("SPEC-AUTO-02/06/07: record-view sync publishes one sanitized saved revision and only referenced fields", async () => {
  let authorizedBody: unknown;
  let transportedBody: unknown;
  let transportedToken = "";
  const sync = createRecordViewTemplateSync({
    identity: {
      async authorize(body) {
        assert.deepEqual(body.scope, scope);
        const authorized = {
          authorization: "signed-session-token",
          body: { ...body, scope: { tenantKey: "tenant-a", ...body.scope } },
        };
        authorizedBody = authorized.body;
        return authorized;
      },
    },
    registry: {
      async upsert(body, authorization) {
        transportedBody = body;
        transportedToken = authorization;
      },
    },
  });

  const result = await sync.sync(scope, stored());
  assert.deepEqual(result, {
    status: "ready",
    templateId: "template-a",
    revision: "fnv1a32:12345678",
  });
  assert.deepEqual(transportedBody, authorizedBody);
  assert.equal(transportedToken, "signed-session-token");
  assert.deepEqual((transportedBody as { template: { referencedFieldIds: string[] } }).template.referencedFieldIds,
    ["field-a", "field-lines"]);
  assert.equal(JSON.stringify(transportedBody).includes("field-unused"), true);
  assert.equal(JSON.stringify(transportedBody).includes("recordValues"), false);
});

test("SPEC-AUTO-07/08: a saved template remains distinguishable from a failed automation sync", async () => {
  const sync = createRecordViewTemplateSync({
    identity: { async authorize(body) { return {
      authorization: "signed-session-token",
      body: { ...body, scope: { tenantKey: "tenant-a", ...body.scope } },
    }; } },
    registry: { async upsert() { throw new Error("registry unavailable"); } },
  });
  await assert.rejects(sync.sync(scope, stored()), /模板已保存.*自动化同步失败.*registry unavailable/);
});

test("SPEC-AUTO-02/07: removing a saved template publishes an authenticated tombstone", async () => {
  let authorizedBody: unknown;
  let transportedBody: unknown;
  const sync = createRecordViewTemplateSync({
    identity: { async authorize(body) {
      authorizedBody = { ...body, scope: { tenantKey: "tenant-a", ...body.scope } };
      return { authorization: "signed-session-token", body: authorizedBody as never };
    } },
    registry: { async upsert(body) { transportedBody = body; } },
  });

  const result = await sync.remove(scope, stored());
  assert.deepEqual(result, {
    status: "deleted",
    templateId: "template-a",
    revision: "fnv1a32:12345678",
  });
  assert.deepEqual(transportedBody, authorizedBody);
  assert.equal((transportedBody as { template: { status: string } }).template.status, "deleted");
});
