export type TemplateStorage = {
  getData<T = unknown>(key: string): Promise<T | null | undefined>;
  setData<T = unknown>(key: string, data: T): Promise<boolean>;
  compareAndSetData?<T = unknown>(key: string, data: T, expectedRevision: string | null): Promise<boolean>;
};

export type StoredTemplate = {
  id: string;
  name: string;
  template: unknown;
  checksum: string;
  updatedAt: string;
  // Record identities belong to the selected template, never to its printable canvas.
  savedBatchRecordIds?: string[];
};

export type TemplateContext = {
  baseId: string;
  tableId: string;
};

export type SaveTemplateOptions = {
  expectedChecksum: string | null;
};

export type TemplateRepository = {
  list(context: TemplateContext): Promise<TemplateCollection>;
  upsert(context: TemplateContext, template: unknown, options: {
    id: string; name: string; expectedRevision: string | null; savedBatchRecordIds?: string[];
  }): Promise<TemplateCollection>;
  setBatchRecords(context: TemplateContext, id: string, recordIds: string[], expectedRevision: string | null): Promise<TemplateCollection>;
  rename(context: TemplateContext, id: string, name: string, expectedRevision: string | null): Promise<TemplateCollection>;
  remove(context: TemplateContext, id: string, expectedRevision: string | null): Promise<TemplateCollection>;
  setDefault(context: TemplateContext, id: string, expectedRevision: string | null): Promise<TemplateCollection>;
  load(context: TemplateContext): Promise<StoredTemplate | null>;
  save(context: TemplateContext, template: unknown, options: SaveTemplateOptions): Promise<StoredTemplate>;
};

export type TemplateCollection = {
  templates: StoredTemplate[];
  defaultId: string | null;
  revision: string | null;
};

type TemplateEnvelopeV2 = {
  schemaVersion: 2;
  engine: "vue-print-designer";
  engineVersion: "1.7.39";
  baseId: string;
  tableId: string;
  templates: StoredTemplate[];
  defaultId: string | null;
  revision: string;
};

export type TemplateLoadForUseResult = {
  stored: StoredTemplate | null;
  warning: string | null;
  canSave: boolean;
};

type TemplateEnvelopeV1 = {
  schemaVersion: 1;
  engine: "vue-print-designer";
  engineVersion: "1.7.39";
  tableId: string;
  baseId?: string;
  updatedAt: string;
  checksum: string;
  template: unknown;
};

const SCHEMA_VERSION = 1;
const ENGINE = "vue-print-designer";
const ENGINE_VERSION = "1.7.39";

export function templateStorageKey(baseId: string, tableId: string): string {
  if (!baseId.trim() || !tableId.trim()) throw new Error("活动模板缺少 baseId/tableId");
  return `duowei-print:active-template:${baseId}:${tableId}`;
}

export function templateCollectionKey(baseId: string, tableId: string): string {
  if (!baseId.trim() || !tableId.trim()) throw new Error("模板集合缺少 baseId/tableId");
  return `duowei-print:templates:${baseId}:${tableId}`;
}

export function legacyTemplateStorageKey(tableId: string): string {
  if (!tableId.trim()) throw new Error("活动模板缺少 tableId");
  return `duowei-print:active-template:${tableId}`;
}

export async function loadTemplateForUse(
  repository: TemplateRepository,
  context: TemplateContext,
): Promise<TemplateLoadForUseResult> {
  try {
    return {
      stored: await repository.load(context),
      warning: null,
      canSave: true,
    };
  } catch (cause) {
    return {
      stored: null,
      warning: cause instanceof Error ? cause.message : "活动模板读取失败",
      canSave: false,
    };
  }
}

const RUNTIME_RECORD_KEYS = new Set([
  "documents",
  "recorddata",
  "recordid",
  "recordids",
  "records",
  "recordvalues",
  "runtimevalues",
  "testdata",
  "variables",
]);

function normalizedTemplateKey(key: string): string {
  return key.replace(/[-_]/g, "").toLowerCase();
}

function isSensitiveTemplateKey(key: string): boolean {
  const normalized = normalizedTemplateKey(key);
  return RUNTIME_RECORD_KEYS.has(normalized)
    || normalized === "authorization"
    || normalized === "refreshtoken"
    || normalized.endsWith("accesstoken");
}

function sanitizeTemplate(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("打印模板包含不可序列化的数值");
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error("打印模板包含循环引用，无法保存");
    seen.add(value);
    const result = value.map((item) => sanitizeTemplate(item, seen));
    seen.delete(value);
    return result;
  }
  if (typeof value !== "object") {
    throw new Error("打印模板包含不可序列化的数据");
  }
  if (seen.has(value)) throw new Error("打印模板包含循环引用，无法保存");
  seen.add(value);
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    if (isSensitiveTemplateKey(key)) continue;
    if (source.type === "table" && key === "data") {
      result.data = [];
      continue;
    }
    result[key] = sanitizeTemplate(item, seen);
  }
  seen.delete(value);
  return result;
}

function assertTemplateShape(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("活动模板格式无效：根节点不是对象");
  const template = value as Record<string, unknown>;
  const canvasSize = template.canvasSize as Record<string, unknown> | undefined;
  if (!Array.isArray(template.pages)
    || !canvasSize
    || typeof canvasSize.width !== "number"
    || typeof canvasSize.height !== "number") {
    throw new Error("活动模板格式无效：缺少 pages 或 canvasSize");
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function checksum(value: unknown): string {
  const input = canonicalJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function parseEnvelope(raw: unknown, context: TemplateContext): TemplateEnvelopeV1 {
  if (!raw || typeof raw !== "object") throw new Error("活动模板存储格式无效");
  const envelope = raw as Partial<TemplateEnvelopeV1> & { schemaVersion?: unknown };
  if (typeof envelope.schemaVersion === "number" && envelope.schemaVersion > SCHEMA_VERSION) {
    throw new Error("活动模板版本过新，当前版本无法安全读取");
  }
  if (envelope.schemaVersion !== SCHEMA_VERSION) throw new Error("活动模板存储版本无效");
  if (envelope.engine !== ENGINE || envelope.engineVersion !== ENGINE_VERSION) {
    throw new Error("活动模板引擎版本不兼容，请先完成模板迁移");
  }
  if (envelope.tableId !== context.tableId) throw new Error("活动模板与当前数据表不匹配");
  if (envelope.baseId !== undefined && envelope.baseId !== context.baseId) {
    throw new Error("活动模板与当前多维表格不匹配");
  }
  if (typeof envelope.updatedAt !== "string" || typeof envelope.checksum !== "string") {
    throw new Error("活动模板元数据不完整");
  }
  const sanitized = sanitizeTemplate(envelope.template);
  assertTemplateShape(sanitized);
  if (canonicalJson(sanitized) !== canonicalJson(envelope.template)) {
    throw new Error("活动模板包含不允许持久化的运行数据");
  }
  if (checksum(sanitized) !== envelope.checksum) {
    throw new Error("活动模板校验失败，未加载可能损坏的数据");
  }
  return envelope as TemplateEnvelopeV1;
}

function collectionRevision(templates: StoredTemplate[], defaultId: string | null): string {
  return checksum({ templates, defaultId });
}

function isMissingStorageValue(raw: unknown): raw is null | undefined | Record<string, never> {
  if (raw === null || raw === undefined) return true;
  if (typeof raw !== "object" || Array.isArray(raw)) return false;
  const prototype = Object.getPrototypeOf(raw);
  // Feishu bridge.getData returns {} for an unset key, unlike the SDK's declared return type.
  return (prototype === Object.prototype || prototype === null) && Object.keys(raw).length === 0;
}

function parseCollection(raw: unknown, context: TemplateContext): TemplateCollection {
  if (!raw || typeof raw !== "object") throw new Error("模板集合存储格式无效");
  const envelope = raw as Partial<TemplateEnvelopeV2>;
  if (typeof envelope.schemaVersion === "number" && envelope.schemaVersion > 2) {
    throw new Error("模板集合版本过新，当前版本无法安全读取");
  }
  if (envelope.schemaVersion !== 2 || envelope.engine !== ENGINE || envelope.engineVersion !== ENGINE_VERSION
    || envelope.baseId !== context.baseId || envelope.tableId !== context.tableId
    || !Array.isArray(envelope.templates) || typeof envelope.revision !== "string") {
    throw new Error("模板集合存储格式无效或引擎版本不兼容");
  }
  if (envelope.defaultId !== null && typeof envelope.defaultId !== "string") {
    throw new Error("模板集合默认项无效");
  }
  const ids = new Set<string>();
  for (const item of envelope.templates) {
    if (!item || typeof item.id !== "string" || !item.id.trim() || ids.has(item.id)
      || typeof item.name !== "string" || !item.name.trim()
      || typeof item.updatedAt !== "string" || typeof item.checksum !== "string") {
      throw new Error("模板集合条目无效");
    }
    ids.add(item.id);
    if (item.savedBatchRecordIds !== undefined && (!Array.isArray(item.savedBatchRecordIds)
      || item.savedBatchRecordIds.length > 50
      || item.savedBatchRecordIds.some((id) => typeof id !== "string" || !id.trim())
      || new Set(item.savedBatchRecordIds).size !== item.savedBatchRecordIds.length)) {
      throw new Error("模板保存的打印记录无效");
    }
    const sanitized = sanitizeTemplate(item.template);
    assertTemplateShape(sanitized);
    if (canonicalJson(sanitized) !== canonicalJson(item.template)) {
      throw new Error("活动模板包含不允许持久化的运行数据");
    }
    if (checksum(sanitized) !== item.checksum) throw new Error("活动模板校验失败，未加载可能损坏的数据");
  }
  if ((ids.size === 0 && envelope.defaultId !== null)
    || (ids.size > 0 && !ids.has(envelope.defaultId ?? ""))) {
    throw new Error("模板集合默认项无效");
  }
  if (collectionRevision(envelope.templates, envelope.defaultId) !== envelope.revision) {
    throw new Error("模板集合校验失败，未加载可能损坏的数据");
  }
  return cloneJsonValue({ templates: envelope.templates, defaultId: envelope.defaultId, revision: envelope.revision });
}

export function templateCollectionEnvelope(context: TemplateContext, collection: TemplateCollection): unknown {
  const envelope = {
    schemaVersion: 2, engine: ENGINE, engineVersion: ENGINE_VERSION,
    ...context, templates: cloneJsonValue(collection.templates), defaultId: collection.defaultId,
    revision: collectionRevision(collection.templates, collection.defaultId),
  };
  parseCollection(envelope, context);
  return envelope;
}

export function createTemplateRepository(
  storage: TemplateStorage,
  now: () => Date = () => new Date(),
): TemplateRepository {
  const readEnvelope = async (context: TemplateContext): Promise<TemplateEnvelopeV1 | null> => {
    const currentRaw = await storage.getData(templateStorageKey(context.baseId, context.tableId));
    if (!isMissingStorageValue(currentRaw)) return parseEnvelope(currentRaw, context);
    const legacyRaw = await storage.getData(legacyTemplateStorageKey(context.tableId));
    return isMissingStorageValue(legacyRaw) ? null : parseEnvelope(legacyRaw, context);
  };

  const readCollection = async (context: TemplateContext): Promise<TemplateCollection> => {
    const raw = await storage.getData(templateCollectionKey(context.baseId, context.tableId));
    if (!isMissingStorageValue(raw)) return parseCollection(raw, context);
    const legacy = await readEnvelope(context);
    if (!legacy) return { templates: [], defaultId: null, revision: null };
    return {
      templates: [{ id: "migrated-v1", name: "原有模板", template: legacy.template,
        checksum: legacy.checksum, updatedAt: legacy.updatedAt }],
      defaultId: "migrated-v1",
      revision: `legacy:${legacy.checksum}`,
    };
  };

  const mutate = async (context: TemplateContext, expectedRevision: string | null,
    change: (collection: TemplateCollection) => void): Promise<TemplateCollection> => {
    const collection = await readCollection(context);
    if (collection.revision !== expectedRevision) {
      throw new Error("模板集合已被其他窗口更新，请重新加载后再保存");
    }
    change(collection);
    const revision = collectionRevision(collection.templates, collection.defaultId);
    const envelope: TemplateEnvelopeV2 = {
      schemaVersion: 2, engine: ENGINE, engineVersion: ENGINE_VERSION,
      baseId: context.baseId, tableId: context.tableId,
      templates: collection.templates, defaultId: collection.defaultId, revision,
    };
    const key = templateCollectionKey(context.baseId, context.tableId);
    const persisted = storage.compareAndSetData
      ? await storage.compareAndSetData(key, envelope, expectedRevision)
      : await storage.setData(key, envelope);
    if (!persisted) throw new Error("活动模板保存失败，飞书存储未确认写入");
    return cloneJsonValue({ templates: collection.templates, defaultId: collection.defaultId, revision });
  };

  const requireItem = (collection: TemplateCollection, id: string) => {
    const item = collection.templates.find((entry) => entry.id === id);
    if (!item) throw new Error("所选模板已不存在，请重新加载");
    return item;
  };

  return {
    list: readCollection,
    upsert(context, template, options) {
      const sanitized = sanitizeTemplate(template);
      assertTemplateShape(sanitized);
      if (!options.id.trim() || !options.name.trim()) throw new Error("模板 ID 和名称不能为空");
      return mutate(context, options.expectedRevision, (collection) => {
        const existing = collection.templates.find((entry) => entry.id === options.id);
        const recordIds = options.savedBatchRecordIds ?? existing?.savedBatchRecordIds;
        if (recordIds !== undefined && (recordIds.length > 50
          || recordIds.some((id) => typeof id !== "string" || !id.trim())
          || new Set(recordIds).size !== recordIds.length)) {
          throw new Error("模板保存的打印记录无效");
        }
        const item: StoredTemplate = {
          id: options.id, name: options.name.trim(), template: sanitized,
          checksum: checksum(sanitized), updatedAt: now().toISOString(),
          ...(recordIds === undefined ? {} : { savedBatchRecordIds: [...recordIds] }),
        };
        const index = collection.templates.findIndex((entry) => entry.id === options.id);
        if (index < 0) collection.templates.push(item);
        else collection.templates[index] = item;
        collection.defaultId ??= options.id;
      });
    },
    async setBatchRecords(context, id, recordIds, expectedRevision) {
      if (recordIds.length > 50 || recordIds.some((value) => typeof value !== "string" || !value.trim())
        || new Set(recordIds).size !== recordIds.length) {
        throw new Error("模板保存的打印记录无效");
      }
      return mutate(context, expectedRevision, (collection) => {
        const item = requireItem(collection, id);
        item.savedBatchRecordIds = [...recordIds];
        item.updatedAt = now().toISOString();
      });
    },
    rename(context, id, name, expectedRevision) {
      if (!name.trim()) throw new Error("模板名称不能为空");
      return mutate(context, expectedRevision, (collection) => {
        requireItem(collection, id).name = name.trim();
      });
    },
    remove(context, id, expectedRevision) {
      return mutate(context, expectedRevision, (collection) => {
        requireItem(collection, id);
        if (collection.defaultId === id && collection.templates.length > 1) {
          throw new Error("删除默认模板前，请先设置其他默认模板");
        }
        collection.templates = collection.templates.filter((item) => item.id !== id);
        if (collection.defaultId === id) collection.defaultId = null;
      });
    },
    setDefault(context, id, expectedRevision) {
      return mutate(context, expectedRevision, (collection) => {
        requireItem(collection, id);
        collection.defaultId = id;
      });
    },
    async load(context) {
      const collection = await readCollection(context);
      return collection.templates.find((item) => item.id === collection.defaultId) ?? null;
    },
    async save(context, template, options) {
      const collection = await readCollection(context);
      const current = collection.templates.find((item) => item.id === collection.defaultId);
      if ((current?.checksum ?? null) !== options.expectedChecksum) {
        throw new Error("活动模板已被其他窗口更新，请重新加载后再保存");
      }
      const result = await this.upsert(context, template, {
        id: current?.id ?? "default", name: current?.name ?? "默认模板",
        expectedRevision: collection.revision,
      });
      return result.templates.find((item) => item.id === result.defaultId)!;
    },
  };
}
import { cloneJsonValue } from "./json-clone.ts";
