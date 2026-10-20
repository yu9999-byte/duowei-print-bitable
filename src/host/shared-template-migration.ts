import { createTemplateRepository, templateCollectionEnvelope, templateCollectionKey, templateStorageKey, legacyTemplateStorageKey, type TemplateContext, type TemplateStorage } from "../core/template-repository.ts";
import { createSharedTemplateRepository, createSharedTemplateStorage, type SharedTemplateTransport } from "./shared-template-storage.ts";

/** Copy only; all old template keys remain untouched. Recheck the old revision around the copy. */
export async function migrateLegacyTemplates(options: { legacy: TemplateStorage; shared: SharedTemplateTransport; context: TemplateContext }): Promise<void> {
  const { legacy, shared, context } = options;
  const source = createTemplateRepository(legacy);
  const target = createSharedTemplateRepository(shared);
  const markerKey = `duowei-print:shared-migration:${context.baseId}:${context.tableId}`;
  const collection = await source.list(context);
  const marker = await legacy.getData<{ sourceRevision?: unknown }>(markerKey);
  if (marker && Object.prototype.hasOwnProperty.call(marker, "sourceRevision")) {
    if (marker.sourceRevision !== collection.revision) throw new Error("旧入口模板在迁移后发生变化，请先核对两边模板，未覆盖共享库");
    return;
  }
  const backupKeys = [templateCollectionKey(context.baseId, context.tableId), templateStorageKey(context.baseId, context.tableId), legacyTemplateStorageKey(context.tableId)];
  const backup = Object.fromEntries(await Promise.all(backupKeys.map(async (key) => [key, await legacy.getData(key)])));
  const backupKey = `${markerKey}:backup:${collection.revision ?? "empty"}`;
  const existingBackup = await legacy.getData<Record<string, unknown>>(backupKey);
  if (!existingBackup || !Object.keys(existingBackup).length) {
    if (!await legacy.setData(backupKey, backup)) throw new Error("旧模板备份未确认成功，迁移未执行");
    if (JSON.stringify(await legacy.getData(backupKey)) !== JSON.stringify(backup)) throw new Error("旧模板备份回读不一致，迁移未执行");
  } else if (JSON.stringify(existingBackup) !== JSON.stringify(backup)) {
    throw new Error("旧模板备份与当前源不一致，请先核对；迁移未执行");
  }
  const envelope = templateCollectionEnvelope(context, collection) as { revision: string };
  const current = await target.list(context);
  if (current.revision !== null && current.revision !== envelope.revision) throw new Error("共享库已有不同模板，请先核对冲突；旧模板和共享模板均已保留");
  if ((await source.list(context)).revision !== collection.revision) throw new Error("旧模板在盘点后发生变化，请重新加载后迁移");
  if (current.revision === null) await createSharedTemplateStorage(shared).compareAndSetData!(templateCollectionKey(context.baseId, context.tableId), envelope, null);
  const imported = await target.list(context);
  if (imported.revision !== envelope.revision || (await source.list(context)).revision !== collection.revision) throw new Error("模板迁移回读或源版本不一致，请核对后继续；旧模板已保留");
  if (!await legacy.setData(markerKey, { sourceRevision: collection.revision, importedRevision: imported.revision, backupKey })) throw new Error("迁移确认未保存，请重新加载核对");
}
