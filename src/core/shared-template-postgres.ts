import type { SharedTemplateStore } from "./shared-template-service.ts";

export type SharedTemplateDatabase = {
  query(sql: string, values: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
};

/** Server-only adapter; pass a PostgreSQL pool, never browser credentials. */
export function createPostgresSharedTemplateStore(db: SharedTemplateDatabase): SharedTemplateStore {
  return {
    async read(scope) {
      const result = await db.query(
        "SELECT envelope FROM duowei_shared_template_collection WHERE tenant_key=$1 AND base_id=$2 AND table_id=$3",
        [scope.tenantKey, scope.baseId, scope.tableId],
      );
      if (!result.rows.length) return null;
      if (result.rows.length !== 1) throw new Error("共享模板存储作用域不唯一");
      return structuredClone(result.rows[0].envelope);
    },
    async compareAndSet(scope, expectedRevision, value) {
      const revision = (value as { revision: string }).revision;
      const parameters: unknown[] = [scope.tenantKey, scope.baseId, scope.tableId, revision, JSON.stringify(value)];
      // A stale writer must not recreate a missing collection. Insert and update are distinct operations.
      const result = expectedRevision === null
        ? await db.query(
          "INSERT INTO duowei_shared_template_collection(tenant_key,base_id,table_id,revision,envelope) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(tenant_key,base_id,table_id) DO NOTHING RETURNING revision",
          parameters,
        )
        : await db.query(
          "UPDATE duowei_shared_template_collection SET revision=$4,envelope=$5::jsonb,updated_at=CURRENT_TIMESTAMP WHERE tenant_key=$1 AND base_id=$2 AND table_id=$3 AND revision=$6 RETURNING revision",
          [...parameters, expectedRevision],
        );
      return result.rowCount === 1;
    },
  };
}
