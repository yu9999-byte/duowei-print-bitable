import type { StoredTemplate } from "../core/template-repository.ts";
import { RegistryConnectionRequiredError } from "./registry-write-authorization.ts";
import { sanitizeAutomationTemplateSnapshot } from "./automation-domain.ts";
import type {
  AuthorizedRegistryWrite,
  RegistryWriteDraftRequest,
  RegistryWriteRequest,
} from "./template-registry-service.ts";
import type { TemplateRegistryScope } from "./template-registry.ts";

export type TemplateSyncScope = Omit<TemplateRegistryScope, "tenantKey">;

export type TemplateSyncResult = {
  status: "ready" | "deleted";
  templateId: string;
  revision: string;
};

export type RecordViewTemplateSyncDependencies = {
  identity: {
    authorize(body: RegistryWriteDraftRequest): Promise<AuthorizedRegistryWrite>;
  };
  registry: {
    upsert(body: RegistryWriteRequest, authorization: string): Promise<void>;
  };
};

export type RecordViewTemplateDraftWriter = {
  write(body: RegistryWriteDraftRequest): Promise<void>;
};

const FIELD_TOKEN_PATTERN = /@__duowei_field_([A-Za-z0-9_.-]+)/g;

function referencedFieldIds(snapshot: unknown): string[] {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return [];
  const pages = (snapshot as Record<string, unknown>).pages;
  if (!Array.isArray(pages)) return [];
  const result: string[] = [];
  const seenIds = new Set<string>();
  const visited = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      FIELD_TOKEN_PATTERN.lastIndex = 0;
      for (const match of value.matchAll(FIELD_TOKEN_PATTERN)) {
        const fieldId = match[1];
        if (!seenIds.has(fieldId)) {
          seenIds.add(fieldId);
          result.push(fieldId);
        }
      }
      return;
    }
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else {
      for (const item of Object.values(value as Record<string, unknown>)) visit(item);
    }
  };
  visit(pages);
  return result;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [已隐藏]")
    .replace(/((?:tenant|user)[_-]?access[_-]?token\s*[=:]\s*)[^\s,;]+/gi, "$1[已隐藏]")
    .slice(0, 500)
    .trim() || "同步服务不可用";
}

export function createRecordViewTemplateSyncWithWriter(writer: RecordViewTemplateDraftWriter): {
  sync(scope: TemplateSyncScope, stored: StoredTemplate): Promise<TemplateSyncResult>;
  remove(scope: TemplateSyncScope, stored: StoredTemplate): Promise<TemplateSyncResult>;
} {
  const write = async (
    scope: TemplateSyncScope,
    stored: StoredTemplate,
    status: "ready" | "deleted",
  ): Promise<TemplateSyncResult> => {
    const snapshot = sanitizeAutomationTemplateSnapshot(stored.template);
    const body: RegistryWriteDraftRequest = {
      scope: {
        baseToken: scope.baseToken,
        tableId: scope.tableId,
      },
      template: {
        id: stored.id,
        name: stored.name,
        revision: stored.checksum,
        snapshot,
        referencedFieldIds: referencedFieldIds(snapshot),
        ...(status === "deleted" ? { status } : {}),
      },
    };
    try {
      await writer.write(body);
      return { status, templateId: stored.id, revision: stored.checksum };
    } catch (error) {
      if (error instanceof RegistryConnectionRequiredError) {
        throw new RegistryConnectionRequiredError(
          error.connectUrl,
          `模板已保存，但自动化尚未连接：${safeError(error)}`,
        );
      }
      throw new Error(`模板已保存，但自动化同步失败：${safeError(error)}`);
    }
  };
  return {
    sync: (scope, stored) => write(scope, stored, "ready"),
    remove: (scope, stored) => write(scope, stored, "deleted"),
  };
}

export function createRecordViewTemplateSync(dependencies: RecordViewTemplateSyncDependencies): {
  sync(scope: TemplateSyncScope, stored: StoredTemplate): Promise<TemplateSyncResult>;
  remove(scope: TemplateSyncScope, stored: StoredTemplate): Promise<TemplateSyncResult>;
} {
  return createRecordViewTemplateSyncWithWriter({
    async write(body) {
      const authorized = await dependencies.identity.authorize(body);
      if (!authorized.authorization.trim()) throw new Error("模板同步身份签名为空");
      await dependencies.registry.upsert(authorized.body, authorized.authorization);
    },
  });
}
