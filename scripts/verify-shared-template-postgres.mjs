import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createSharedTemplateService } from "../src/core/shared-template-service.ts";
import { createPostgresSharedTemplateStore } from "../src/core/shared-template-postgres.ts";
import { createSharedTemplateRepository } from "../src/host/shared-template-storage.ts";

const psql = process.env.DUOWEI_TEST_PSQL;
if (!psql || !process.env.PGPORT || !process.env.PGDATABASE) throw new Error("Isolated PostgreSQL test configuration is required");
function run(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn(psql, ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-"], { windowsHide: true, env: { ...process.env, PGCLIENTENCODING: "UTF8" } });
    child.stdin.end(sql, "utf8");
    let output = "";
    let errors = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { errors += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(`PostgreSQL test query failed (${code}): ${errors.slice(0, 600)}`)));
  });
}
await run(await readFile(new URL("../docs/migrations/0001-shared-template-collection.sql", import.meta.url), "utf8"));
const db = {
  async query(sql, values) {
    // Test-only psql transport. Production uses driver parameter binding through the SQL port.
    const bound = sql.replace(/\$(\d+)/g, (_match, index) => `'${String(values[Number(index) - 1]).replaceAll("'", "''")}'`);
    const rows = JSON.parse(await run(`WITH result AS (${bound}) SELECT COALESCE(json_agg(result),'[]'::json) FROM result`));
    return { rows, rowCount: rows.length };
  },
};
const store = createPostgresSharedTemplateStore(db);
const forTenant = (tenantKey) => createSharedTemplateRepository(createSharedTemplateService({
  store, authorize: async () => ({ tenantKey, canRead: true, canWrite: true }),
}));
const scope = { baseId: "base_test", tableId: "table_test" };
const template = { pages: [{ id: "page", elements: [{ id: "title", type: "text", content: "保留 ' 引号与中文" }] }], canvasSize: { width: 794, height: 1123 } };
const detail = forTenant("tenant_a");
const view = forTenant("tenant_a");
const results = await Promise.allSettled([
  detail.upsert(scope, template, { id: "a", name: "模板甲", expectedRevision: null, savedBatchRecordIds: ["r2", "r1"] }),
  view.upsert(scope, template, { id: "b", name: "模板乙", expectedRevision: null }),
]);
assert.equal(results.filter((result) => result.status === "fulfilled").length, 1, JSON.stringify(results.map((result) => result.status === "rejected" ? result.reason.message : "saved")));
assert.equal(results.filter((result) => result.status === "rejected").length, 1);
const current = await detail.list(scope);
assert.deepEqual(await view.list(scope), current);
assert.equal((await forTenant("tenant_b").list(scope)).templates.length, 0);
assert.equal((await view.list({ ...scope, tableId: "other" })).templates.length, 0);
const id = current.templates[0].id;
const edits = await Promise.allSettled([
  detail.rename(scope, id, "新名称甲", current.revision),
  view.rename(scope, id, "新名称乙", current.revision),
]);
assert.equal(edits.filter((result) => result.status === "fulfilled").length, 1);
const saved = await detail.list(scope);
// Every psql call starts a new connection; fresh service/repository instances also see committed data.
assert.deepEqual(await forTenant("tenant_a").list(scope), saved);
assert.equal(saved.templates[0].checksum, current.templates[0].checksum);
console.log("PostgreSQL PASS: concurrent create/update CAS, tenant/table isolation, Unicode, fresh-connection persistence");
