import {
  signRegistryWriteRequest,
  type AuthorizedRegistryWrite,
  type RegistryWriteDraftRequest,
  type RegistryWriteIdentity,
  type RegistryWriteRequest,
} from "./template-registry-service.ts";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type AuthorizationOptions = {
  signingSecret: Uint8Array;
  verifyIdentity(
    request: Request,
    body: RegistryWriteDraftRequest,
  ): Promise<RegistryWriteIdentity>;
  now?: () => number;
  maxRequestBytes?: number;
};

export class RegistryConnectionRequiredError extends Error {
  readonly connectUrl: string;

  constructor(connectUrl: string, message = "请先连接飞书账号以启用自动化模板同步") {
    super(message);
    this.name = "RegistryConnectionRequiredError";
    this.connectUrl = connectUrl;
  }
}

function sameDraftScope(identity: RegistryWriteIdentity, body: RegistryWriteDraftRequest): boolean {
  return identity.baseToken === body.scope.baseToken
    && identity.tableId === body.scope.tableId;
}

function requiredString(label: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}不能为空`);
  return value.trim();
}

function parseDraft(value: unknown): RegistryWriteDraftRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("模板同步授权请求无效");
  }
  const root = value as Record<string, unknown>;
  if (Object.keys(root).some((key) => key !== "scope" && key !== "template")) {
    throw new Error("模板同步授权请求包含不支持的属性");
  }
  if (!root.scope || typeof root.scope !== "object" || Array.isArray(root.scope)
    || !root.template || typeof root.template !== "object" || Array.isArray(root.template)) {
    throw new Error("模板同步授权请求无效");
  }
  const scope = root.scope as Record<string, unknown>;
  if (Object.keys(scope).some((key) => key !== "baseToken" && key !== "tableId")) {
    throw new Error("模板同步授权作用域包含不支持的属性");
  }
  return {
    scope: {
      baseToken: requiredString("多维表格", scope.baseToken),
      tableId: requiredString("数据表", scope.tableId),
    },
    template: root.template as RegistryWriteDraftRequest["template"],
  };
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [已隐藏]")
    .replace(/((?:tenant|user)[_-]?access[_-]?token\s*[=:]\s*)[^\s,;]+/gi, "$1[已隐藏]")
    .slice(0, 500)
    .trim() || "身份校验失败";
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  traceId: string,
  extra: Record<string, unknown> = {},
): Response {
  return new Response(JSON.stringify({ success: false, code, message, traceId, ...extra }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-duowei-trace-id": traceId,
    },
  });
}

export function createRegistryWriteAuthorizationHttpHandler(
  options: AuthorizationOptions,
): (request: Request) => Promise<Response> {
  const now = options.now ?? Date.now;
  const maxRequestBytes = options.maxRequestBytes ?? 2 * 1024 * 1024;
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1) {
    throw new Error("模板同步授权请求大小上限无效");
  }
  return async (request) => {
    const traceId = crypto.randomUUID();
    if (request.method !== "POST") {
      return errorResponse(405, "METHOD_NOT_ALLOWED", "模板同步授权只接受 POST 请求", traceId);
    }
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return errorResponse(415, "CONTENT_TYPE_INVALID", "模板同步授权请求必须使用 JSON", traceId);
    }
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > maxRequestBytes) {
      return errorResponse(413, "REQUEST_TOO_LARGE", "模板同步授权请求超过大小限制", traceId);
    }
    let body: RegistryWriteDraftRequest;
    try {
      body = parseDraft(JSON.parse(rawBody) as unknown);
    } catch {
      return errorResponse(400, "REQUEST_INVALID", "模板同步授权请求无效", traceId);
    }
    try {
      const identity = await options.verifyIdentity(request, body);
      if (!identity.principalId?.trim() || !identity.tenantKey?.trim()
        || !identity.canWrite || !sameDraftScope(identity, body)) {
        throw new Error("当前飞书身份没有此模板作用域的写入权限");
      }
      const authorizedBody: RegistryWriteRequest = {
        ...body,
        scope: { tenantKey: identity.tenantKey.trim(), ...body.scope },
      };
      const authorization = await signRegistryWriteRequest(
        authorizedBody,
        identity,
        options.signingSecret,
        now(),
      );
      return new Response(JSON.stringify({ success: true, authorization, body: authorizedBody }), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-duowei-trace-id": traceId,
        },
      });
    } catch (error) {
      if (error instanceof RegistryConnectionRequiredError) {
        return errorResponse(401, "AUTH_REQUIRED", error.message, traceId, {
          connectUrl: error.connectUrl,
        });
      }
      return errorResponse(401, "IDENTITY_INVALID", safeMessage(error), traceId);
    }
  };
}

export function createRegistryWriteAuthorizationClient(options: {
  endpoint: string;
  fetch?: FetchLike;
}): {
  authorize(body: RegistryWriteDraftRequest): Promise<AuthorizedRegistryWrite>;
} {
  const fetcher = options.fetch ?? fetch;
  return {
    async authorize(body) {
      const draft = parseDraft(body);
      const response = await fetcher(options.endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      let payload: {
        authorization?: string;
        body?: RegistryWriteRequest;
        message?: string;
        code?: string;
        traceId?: string;
        connectUrl?: string;
      } = {};
      try {
        payload = await response.json() as typeof payload;
      } catch {
        if (!response.ok) throw new Error(`模板同步授权服务 HTTP_${response.status}`);
      }
      if (payload.code === "AUTH_REQUIRED" && payload.connectUrl) {
        let connectUrl: URL;
        try {
          connectUrl = new URL(payload.connectUrl);
        } catch {
          throw new Error("模板同步授权服务返回了无效连接地址");
        }
        if (connectUrl.protocol !== "https:" || connectUrl.username || connectUrl.password) {
          throw new Error("模板同步授权服务返回了不安全连接地址");
        }
        throw new RegistryConnectionRequiredError(
          connectUrl.toString(),
          safeMessage(payload.message ?? "请先连接飞书账号以启用自动化模板同步"),
        );
      }
      if (!response.ok || !payload.authorization?.trim() || !payload.body) {
        const trace = payload.traceId ? `（traceId: ${payload.traceId}）` : "";
        throw new Error(`${payload.code ?? `HTTP_${response.status}`}：${safeMessage(payload.message ?? response.statusText)}${trace}`);
      }
      if (payload.body.scope.baseToken !== draft.scope.baseToken
        || payload.body.scope.tableId !== draft.scope.tableId
        || !payload.body.scope.tenantKey?.trim()) {
        throw new Error("模板同步授权服务返回了不一致的作用域");
      }
      return { authorization: payload.authorization, body: payload.body };
    },
  };
}
