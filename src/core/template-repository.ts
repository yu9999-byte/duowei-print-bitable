export type TemplateStorage = {
  getData<T = unknown>(key: string): Promise<T | null | undefined>;
  setData<T = unknown>(key: string, data: T): Promise<boolean>;
};

export type StoredTemplate = {
  template: unknown;
  checksum: string;
  updatedAt: string;
};

export type TemplateContext = {
  baseId: string;
  tableId: string;
};

export type SaveTemplateOptions = {
  expectedChecksum: string | null;
};

export type TemplateRepository = {
  load(context: TemplateContext): Promise<StoredTemplate | null>;
  save(context: TemplateContext, template: unknown, options: SaveTemplateOptions): Promise<StoredTemplate>;
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
    if (key === "testData" || key === "variables") continue;
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

export function createTemplateRepository(
  storage: TemplateStorage,
  now: () => Date = () => new Date(),
): TemplateRepository {
  const readEnvelope = async (context: TemplateContext): Promise<TemplateEnvelopeV1 | null> => {
    const currentRaw = await storage.getData(templateStorageKey(context.baseId, context.tableId));
    if (currentRaw !== null && currentRaw !== undefined) return parseEnvelope(currentRaw, context);
    const legacyRaw = await storage.getData(legacyTemplateStorageKey(context.tableId));
    return legacyRaw === null || legacyRaw === undefined ? null : parseEnvelope(legacyRaw, context);
  };

  return {
    async load(context) {
      const envelope = await readEnvelope(context);
      if (!envelope) return null;
      return structuredClone({
        template: envelope.template,
        checksum: envelope.checksum,
        updatedAt: envelope.updatedAt,
      });
    },
    async save(context, template, options) {
      const sanitized = sanitizeTemplate(template);
      assertTemplateShape(sanitized);
      const current = await readEnvelope(context);
      if ((current?.checksum ?? null) !== options.expectedChecksum) {
        throw new Error("活动模板已被其他窗口更新，请重新加载后再保存");
      }
      const envelope: TemplateEnvelopeV1 = {
        schemaVersion: SCHEMA_VERSION,
        engine: ENGINE,
        engineVersion: ENGINE_VERSION,
        tableId: context.tableId,
        baseId: context.baseId,
        updatedAt: now().toISOString(),
        checksum: checksum(sanitized),
        template: sanitized,
      };
      const persisted = await storage.setData(templateStorageKey(context.baseId, context.tableId), envelope);
      if (!persisted) throw new Error("活动模板保存失败，飞书存储未确认写入");
      return structuredClone({
        template: envelope.template,
        checksum: envelope.checksum,
        updatedAt: envelope.updatedAt,
      });
    },
  };
}
