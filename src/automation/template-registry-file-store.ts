import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { sanitizeAutomationTemplateSnapshot } from "./automation-domain.ts";
import type {
  RegisteredAutomationTemplate,
  TemplateRegistryScope,
  TemplateSelection,
} from "./template-registry.ts";
import type { TemplateRegistryStore } from "./template-registry-service.ts";

type PersistentRegistryState = {
  version: 1;
  templates: RegisteredAutomationTemplate[];
};

type JsonFileStoreOptions = {
  path: string;
};

function requiredString(label: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}无效`);
  return value.trim();
}

function normalizeTemplate(value: unknown): RegisteredAutomationTemplate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("模板注册表持久化模板无效");
  }
  const item = value as Record<string, unknown>;
  const expected = new Set([
    "tenantKey", "baseToken", "tableId", "id", "name", "revision",
    "status", "snapshot", "referencedFieldIds",
  ]);
  if (Object.keys(item).some((key) => !expected.has(key))) {
    throw new Error("模板注册表持久化模板包含未知属性");
  }
  if (item.status !== "ready" && item.status !== "syncing"
    && item.status !== "error" && item.status !== "deleted") {
    throw new Error("模板注册表持久化模板状态无效");
  }
  if (!Array.isArray(item.referencedFieldIds)) {
    throw new Error("模板注册表持久化字段引用无效");
  }
  const referencedFieldIds = item.referencedFieldIds.map((fieldId) => (
    requiredString("模板字段 ID", fieldId)
  ));
  if (new Set(referencedFieldIds).size !== referencedFieldIds.length) {
    throw new Error("模板注册表持久化字段引用重复");
  }
  return sanitizeAutomationTemplateSnapshot({
    tenantKey: requiredString("模板租户", item.tenantKey),
    baseToken: requiredString("模板多维表格", item.baseToken),
    tableId: requiredString("模板数据表", item.tableId),
    id: requiredString("模板 ID", item.id),
    name: requiredString("模板名称", item.name),
    revision: requiredString("模板修订", item.revision),
    status: item.status,
    snapshot: sanitizeAutomationTemplateSnapshot(item.snapshot),
    referencedFieldIds,
  });
}

function emptyState(): PersistentRegistryState {
  return { version: 1, templates: [] };
}

function sameScope(template: RegisteredAutomationTemplate, scope: TemplateRegistryScope): boolean {
  return template.tenantKey === scope.tenantKey
    && template.baseToken === scope.baseToken
    && template.tableId === scope.tableId;
}

function sameTemplate(
  template: RegisteredAutomationTemplate,
  scope: TemplateRegistryScope,
  selection: TemplateSelection,
): boolean {
  return sameScope(template, scope)
    && template.id === selection.id
    && template.revision === selection.revision;
}

function templateOrder(left: RegisteredAutomationTemplate, right: RegisteredAutomationTemplate): number {
  return [left.tenantKey, left.baseToken, left.tableId, left.id, left.revision]
    .join("\u0000")
    .localeCompare([right.tenantKey, right.baseToken, right.tableId, right.id, right.revision].join("\u0000"));
}

export function createJsonFileTemplateRegistryStore(
  options: JsonFileStoreOptions,
): TemplateRegistryStore {
  const path = options.path.trim();
  if (!path || !isAbsolute(path)) throw new Error("模板注册表持久化路径必须是绝对路径");
  let queue: Promise<void> = Promise.resolve();

  const readState = async (): Promise<PersistentRegistryState> => {
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
      throw new Error(`模板注册表持久化文件无法读取：${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
      const state = parsed as Record<string, unknown>;
      if (state.version !== 1 || !Array.isArray(state.templates)
        || Object.keys(state).some((key) => key !== "version" && key !== "templates")) {
        throw new Error("shape");
      }
      return { version: 1, templates: state.templates.map(normalizeTemplate) };
    } catch (error) {
      throw new Error(`模板注册表持久化 JSON 已损坏，拒绝覆盖：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const writeState = async (state: PersistentRegistryState): Promise<void> => {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(state)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new Error(`模板注册表持久化文件无法原子写入：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };

  return {
    upsert(template) {
      return serialized(async () => {
        const safe = normalizeTemplate(template);
        const state = await readState();
        const templates = state.templates.filter((candidate) => !(
          sameScope(candidate, safe) && candidate.id === safe.id
        ));
        templates.push(safe);
        templates.sort(templateOrder);
        await writeState({ version: 1, templates });
      });
    },
    list(scope) {
      return serialized(async () => (await readState()).templates
        .filter((template) => sameScope(template, scope) && template.status === "ready")
        .map((template) => sanitizeAutomationTemplateSnapshot(template)));
    },
    get(scope, selection) {
      return serialized(async () => {
        const template = (await readState()).templates.find((candidate) => (
          sameTemplate(candidate, scope, selection)
        ));
        return template ? sanitizeAutomationTemplateSnapshot(template) : null;
      });
    },
  };
}
