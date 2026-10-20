import { createTemplateRepository, templateCollectionKey, type TemplateContext, type TemplateStorage } from "../core/template-repository.ts";

export type SharedTemplateRequest = {
  operation: "read" | "compare-and-set";
  scope: TemplateContext;
  expectedRevision?: string | null;
  value?: unknown;
};

/** The service authenticates the user and derives tenant identity; never send a client tenant key. */
export type SharedTemplateTransport = (request: SharedTemplateRequest) => Promise<unknown>;

export class SharedTemplateAuthRequiredError extends Error {
  readonly code = "AUTH_REQUIRED";
  constructor() { super("请先连接飞书账号以访问共享模板"); }
}

export class SharedTemplateTransportUnavailableError extends Error {
  readonly code = "TRANSPORT_UNAVAILABLE";
  readonly cause?: unknown;
  constructor(cause?: unknown) {
    super("共享模板服务暂不可用，请稍后重试");
    if (cause instanceof Error) this.cause = cause;
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("共享模板服务响应无效");
  return value as Record<string, unknown>;
}

export function createSharedTemplateStorage(transport: SharedTemplateTransport): TemplateStorage {
  const scopeOf = (key: string): TemplateContext | null => {
    const match = /^duowei-print:templates:([^:]+):([^:]+)$/.exec(key);
    if (!match) return null;
    return { baseId: match[1], tableId: match[2] };
  };
  return {
    async getData<T>(key: string): Promise<T | null> {
      const scope = scopeOf(key);
      // Legacy bridge keys are intentionally not read through a different plugin or service.
      if (!scope) return null;
      const response = object(await transport({ operation: "read", scope }));
      if (!Object.prototype.hasOwnProperty.call(response, "value")) throw new Error("共享模板服务缺少模板数据");
      return structuredClone(response.value) as T | null;
    },
    async setData() { throw new Error("共享模板必须使用原子版本检查保存"); },
    async compareAndSetData(key, value, expectedRevision) {
      const scope = scopeOf(key);
      if (!scope || key !== templateCollectionKey(scope.baseId, scope.tableId)) throw new Error("共享模板作用域无效");
      const response = object(await transport({ operation: "compare-and-set", scope, value, expectedRevision }));
      if (response.committed !== true) throw new Error("共享模板未确认保存，请重新加载核对");
      return true;
    },
  };
}

export function createSharedTemplateRepository(transport: SharedTemplateTransport) {
  return createTemplateRepository(createSharedTemplateStorage(transport));
}

export function createHostTemplateRepository(options: {
  legacyStorage: TemplateStorage;
  sharedEndpoint: string;
  fetch?: typeof fetch;
}) {
  // Empty configuration preserves the current record entry until a verified cutover.
  // Once enabled, transport failures propagate; they must never fork writes to bridge.
  return options.sharedEndpoint.trim()
    ? createSharedTemplateRepository(createSharedTemplateHttpTransport({ endpoint: options.sharedEndpoint.trim(), fetch: options.fetch }))
    : createTemplateRepository(options.legacyStorage);
}

export function createSharedTemplateHttpTransport(options: {
  endpoint: string;
  fetch?: typeof fetch;
}): SharedTemplateTransport {
  const url = new URL(options.endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) {
    throw new Error("共享模板地址必须使用无凭据、无查询参数的 HTTPS URL");
  }
  const send = options.fetch ?? fetch;
  return async (request) => {
    let response: Response;
    try {
      response = await send(url, {
        method: "POST", credentials: "include", cache: "no-store",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        // Miaoda's login gateway redirects unauthenticated CORS preflights.
        // A simple form request carries the same authenticated JSON envelope.
        signal: AbortSignal.timeout(15_000), body: new URLSearchParams({ request: JSON.stringify(request) }),
      });
    } catch (cause) {
      throw new SharedTemplateTransportUnavailableError(cause);
    }
    // Do not echo response bodies: authentication providers can return credentials or HTML.
    if (response.status === 409) throw new Error("模板集合已被其他窗口更新，请重新加载后再保存");
    if (response.status === 401) throw new SharedTemplateAuthRequiredError();
    if (response.status === 403) throw new Error("没有当前数据表的共享模板访问权限");
    if (!response.ok) throw new Error(`共享模板服务暂不可用（${response.status}），请稍后重试`);
    try {
      return await response.json();
    } catch (cause) {
      throw new SharedTemplateTransportUnavailableError(cause);
    }
  };
}

export function createSharedTemplateResilientTransport(options: {
  direct: SharedTemplateTransport;
  bridge: SharedTemplateTransport;
}): SharedTemplateTransport {
  return async (request) => {
    try {
      return await options.direct(request);
    } catch (cause) {
      if (cause instanceof SharedTemplateAuthRequiredError
        || cause instanceof SharedTemplateTransportUnavailableError) {
        return options.bridge(request);
      }
      throw cause;
    }
  };
}
