import { createTemplateRepository, templateCollectionKey, type TemplateContext } from "./template-repository.ts";
import type { SharedTemplateRequest } from "../host/shared-template-storage.ts";

export type SharedTemplateIdentity = { tenantKey: string; canRead: boolean; canWrite: boolean };
export type SharedTemplateScope = TemplateContext & { tenantKey: string };
export type SharedTemplateStore = {
  read(scope: SharedTemplateScope): Promise<unknown | null>;
  /** Must execute the revision predicate and write as one database operation. */
  compareAndSet(scope: SharedTemplateScope, expectedRevision: string | null, value: unknown): Promise<boolean>;
};

export class SharedTemplateServiceError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** Server-side boundary. Identity must be resolved from a verified session, never the request body. */
export function createSharedTemplateService(options: {
  authorize(scope: TemplateContext): Promise<SharedTemplateIdentity>;
  store: SharedTemplateStore;
}) {
  return async (input: unknown): Promise<unknown> => {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new SharedTemplateServiceError(400, "共享模板请求无效");
    const request = input as SharedTemplateRequest;
    if (!["read", "compare-and-set"].includes(request.operation)) throw new SharedTemplateServiceError(400, "共享模板操作无效");
    const allowed = request.operation === "read" ? ["operation", "scope"] : ["operation", "scope", "value", "expectedRevision"];
    if (Object.keys(request).some((key) => !allowed.includes(key)) || !request.scope || typeof request.scope !== "object"
      || Array.isArray(request.scope) || Object.keys(request.scope).sort().join(",") !== "baseId,tableId"
      || ![request.scope.baseId, request.scope.tableId].every((id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(id))) {
      throw new SharedTemplateServiceError(400, "共享模板作用域无效");
    }
    const context = { baseId: request.scope.baseId, tableId: request.scope.tableId };
    const identity = await options.authorize(context);
    if (!identity.tenantKey || !identity.canRead || (request.operation !== "read" && !identity.canWrite)) {
      throw new SharedTemplateServiceError(403, "没有共享模板访问权限");
    }
    const scope = { ...context, tenantKey: identity.tenantKey };
    if (request.operation === "read") return { value: await options.store.read(scope) };
    if (request.expectedRevision !== null && (typeof request.expectedRevision !== "string" || !request.expectedRevision)) {
      throw new SharedTemplateServiceError(400, "共享模板版本无效");
    }
    // Parse through the same validator used by both clients before allowing persistence.
    if (!request.value || typeof request.value !== "object" || (request.value as { schemaVersion?: unknown }).schemaVersion !== 2) {
      throw new SharedTemplateServiceError(400, "共享模板必须是完整的版本二集合");
    }
    const value = structuredClone(request.value);
    try {
      await createTemplateRepository({
        async getData<T>(key: string) { return (key === templateCollectionKey(context.baseId, context.tableId) ? value : null) as T | null; },
        async setData() { throw new Error("只读验证器"); },
      }).list(context);
    } catch {
      throw new SharedTemplateServiceError(400, "共享模板内容或校验信息无效");
    }
    if (!await options.store.compareAndSet(scope, request.expectedRevision, value)) {
      throw new SharedTemplateServiceError(409, "模板集合已被其他窗口更新");
    }
    return { committed: true };
  };
}
