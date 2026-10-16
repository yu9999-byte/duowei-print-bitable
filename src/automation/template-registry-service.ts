import { sanitizeAutomationTemplateSnapshot } from "./automation-domain.ts";
import {
  base64UrlDecode,
  base64UrlEncode,
  constantTimeEqual,
  hmacSha256,
  portableNonce,
  sha256Base64Url,
  utf8Bytes,
  utf8String,
} from "./portable-crypto.ts";
import type {
  RegisteredAutomationTemplate,
  TemplateRegistryScope,
  TemplateSelection,
} from "./template-registry.ts";

export type RegistryWriteRequest = {
  scope: TemplateRegistryScope;
  template: Omit<RegisteredAutomationTemplate, keyof TemplateRegistryScope | "status"> & {
    status?: "deleted";
  };
};

export type RegistryWriteDraftRequest = {
  scope: Omit<TemplateRegistryScope, "tenantKey">;
  template: RegistryWriteRequest["template"];
};

export type AuthorizedRegistryWrite = {
  body: RegistryWriteRequest;
  authorization: string;
};

export type RegistryWriteIdentity = TemplateRegistryScope & {
  principalId: string;
  canWrite: boolean;
};

export type RegistryReadRequest = {
  operation: "list";
  scope: TemplateRegistryScope;
} | {
  operation: "get";
  scope: TemplateRegistryScope;
  selection: TemplateSelection;
};

type SignedRegistryClaims = RegistryWriteIdentity & {
  version: 1;
  audience: "duowei-template-registry-write";
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  bodyDigest: string;
};

type RegistryOptions = {
  signingSecret: Uint8Array;
  store?: TemplateRegistryStore;
  now?: () => number;
};

type RegistryFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type AuthenticatedTemplateRegistry = {
  upsert(body: RegistryWriteRequest, authorization: string): Promise<void>;
  list(scope: TemplateRegistryScope): Promise<RegisteredAutomationTemplate[]>;
  get(
    scope: TemplateRegistryScope,
    selection: TemplateSelection,
  ): Promise<RegisteredAutomationTemplate | null>;
};

export type TemplateRegistryStore = {
  upsert(template: RegisteredAutomationTemplate): Promise<void>;
  list(scope: TemplateRegistryScope): Promise<RegisteredAutomationTemplate[]>;
  get(
    scope: TemplateRegistryScope,
    selection: TemplateSelection,
  ): Promise<RegisteredAutomationTemplate | null>;
};

const TOKEN_PREFIX = "duowei-registry-v1";
const READ_TOKEN_PREFIX = "duowei-registry-read-v1";
const MAX_TOKEN_AGE_MS = 5 * 60_000;

function canonicalJson(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== "object") throw new Error("模板注册表请求包含不可序列化数据");
  if (seen.has(value)) throw new Error("模板注册表请求包含循环引用");
  seen.add(value);
  const result = Array.isArray(value)
    ? `[${value.map((item) => canonicalJson(item, seen)).join(",")}]`
    : `{${Object.keys(value as Record<string, unknown>).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key], seen)}`
    )).join(",")}}`;
  seen.delete(value);
  return result;
}

async function sha256(value: string): Promise<string> {
  return sha256Base64Url(value);
}

async function hmac(secret: Uint8Array, payload: string): Promise<Uint8Array> {
  if (secret.byteLength < 32) throw new Error("模板注册表签名密钥长度不足");
  return hmacSha256(secret, payload);
}

async function verifyHmac(secret: Uint8Array, payload: string, signature: Uint8Array): Promise<boolean> {
  if (secret.byteLength < 32) throw new Error("模板注册表签名密钥长度不足");
  return constantTimeEqual(hmacSha256(secret, payload), signature);
}

export async function signRegistryWriteRequest(
  body: RegistryWriteRequest,
  identity: RegistryWriteIdentity,
  secret: Uint8Array,
  now = Date.now(),
): Promise<string> {
  const claims: SignedRegistryClaims = {
    version: 1,
    audience: "duowei-template-registry-write",
    principalId: identity.principalId,
    tenantKey: identity.tenantKey,
    baseToken: identity.baseToken,
    tableId: identity.tableId,
    canWrite: identity.canWrite,
    issuedAt: now,
    expiresAt: now + MAX_TOKEN_AGE_MS,
    nonce: portableNonce(),
    bodyDigest: await sha256(canonicalJson(body)),
  };
  const encodedClaims = base64UrlEncode(utf8Bytes(canonicalJson(claims)));
  const signature = base64UrlEncode(await hmac(secret, `${TOKEN_PREFIX}.${encodedClaims}`));
  return `${TOKEN_PREFIX}.${encodedClaims}.${signature}`;
}

async function verifyRegistryWriteRequest(
  body: RegistryWriteRequest,
  token: string,
  secret: Uint8Array,
  now: number,
): Promise<SignedRegistryClaims> {
  const [prefix, encodedClaims, encodedSignature, extra] = token.split(".");
  if (prefix !== TOKEN_PREFIX || !encodedClaims || !encodedSignature || extra) {
    throw new Error("模板注册表身份签名无效");
  }
  if (!await verifyHmac(secret, `${prefix}.${encodedClaims}`, base64UrlDecode(encodedSignature))) {
    throw new Error("模板注册表身份签名无效");
  }
  let claims: SignedRegistryClaims;
  try {
    claims = JSON.parse(utf8String(base64UrlDecode(encodedClaims))) as SignedRegistryClaims;
  } catch {
    throw new Error("模板注册表身份签名无效");
  }
  if (claims.version !== 1 || claims.audience !== "duowei-template-registry-write") {
    throw new Error("模板注册表身份签名无效");
  }
  if (claims.expiresAt < now || claims.issuedAt > now + 30_000) throw new Error("模板注册表身份签名已过期");
  if (!claims.canWrite) throw new Error("当前身份没有模板写入权限");
  if (
    claims.tenantKey !== body.scope.tenantKey
    || claims.baseToken !== body.scope.baseToken
    || claims.tableId !== body.scope.tableId
  ) {
    throw new Error("模板注册表写入作用域不一致");
  }
  if (claims.bodyDigest !== await sha256(canonicalJson(body))) {
    throw new Error("模板注册表请求内容与签名不一致");
  }
  return claims;
}

function parseRegistryReadRequest(value: unknown): RegistryReadRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("模板注册表读取请求无效");
  }
  const root = value as Record<string, unknown>;
  const scopeValue = root.scope;
  if (!scopeValue || typeof scopeValue !== "object" || Array.isArray(scopeValue)) {
    throw new Error("模板注册表读取作用域无效");
  }
  const scopeRecord = scopeValue as Record<string, unknown>;
  const scope: TemplateRegistryScope = {
    tenantKey: typeof scopeRecord.tenantKey === "string" ? scopeRecord.tenantKey.trim() : "",
    baseToken: typeof scopeRecord.baseToken === "string" ? scopeRecord.baseToken.trim() : "",
    tableId: typeof scopeRecord.tableId === "string" ? scopeRecord.tableId.trim() : "",
  };
  if (!scope.tenantKey || !scope.baseToken || !scope.tableId) {
    throw new Error("模板注册表读取作用域无效");
  }
  if (root.operation === "list") {
    if (Object.keys(root).some((key) => key !== "operation" && key !== "scope")) {
      throw new Error("模板注册表读取请求包含不支持的属性");
    }
    return { operation: "list", scope };
  }
  if (root.operation === "get") {
    if (Object.keys(root).some((key) => key !== "operation" && key !== "scope" && key !== "selection")) {
      throw new Error("模板注册表读取请求包含不支持的属性");
    }
    const selectionValue = root.selection;
    if (!selectionValue || typeof selectionValue !== "object" || Array.isArray(selectionValue)) {
      throw new Error("模板注册表模板选择无效");
    }
    const selectionRecord = selectionValue as Record<string, unknown>;
    const selection = {
      id: typeof selectionRecord.id === "string" ? selectionRecord.id.trim() : "",
      revision: typeof selectionRecord.revision === "string" ? selectionRecord.revision.trim() : "",
    };
    if (!selection.id || !selection.revision || Object.keys(selectionRecord).some((key) => key !== "id" && key !== "revision")) {
      throw new Error("模板注册表模板选择无效");
    }
    return { operation: "get", scope, selection };
  }
  throw new Error("模板注册表读取操作无效");
}

export async function signRegistryReadRequest(
  request: RegistryReadRequest,
  secret: Uint8Array,
  now = Date.now(),
): Promise<string> {
  const body = parseRegistryReadRequest(request);
  const claims = {
    version: 1,
    audience: "duowei-template-registry-read",
    issuedAt: now,
    expiresAt: now + MAX_TOKEN_AGE_MS,
    nonce: portableNonce(),
    bodyDigest: await sha256(canonicalJson(body)),
  };
  const encodedClaims = base64UrlEncode(utf8Bytes(canonicalJson(claims)));
  const signature = base64UrlEncode(await hmac(secret, `${READ_TOKEN_PREFIX}.${encodedClaims}`));
  return `${READ_TOKEN_PREFIX}.${encodedClaims}.${signature}`;
}

async function verifyRegistryReadRequest(
  request: RegistryReadRequest,
  token: string,
  secret: Uint8Array,
  now: number,
): Promise<void> {
  const [prefix, encodedClaims, encodedSignature, extra] = token.split(".");
  if (prefix !== READ_TOKEN_PREFIX || !encodedClaims || !encodedSignature || extra) {
    throw new Error("模板注册表读取签名无效");
  }
  if (!await verifyHmac(secret, `${prefix}.${encodedClaims}`, base64UrlDecode(encodedSignature))) {
    throw new Error("模板注册表读取签名无效");
  }
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(utf8String(base64UrlDecode(encodedClaims))) as Record<string, unknown>;
  } catch {
    throw new Error("模板注册表读取签名无效");
  }
  if (claims.version !== 1 || claims.audience !== "duowei-template-registry-read") {
    throw new Error("模板注册表读取签名无效");
  }
  if (typeof claims.expiresAt !== "number" || typeof claims.issuedAt !== "number"
    || claims.expiresAt < now || claims.issuedAt > now + 30_000) {
    throw new Error("模板注册表读取签名已过期");
  }
  if (claims.bodyDigest !== await sha256(canonicalJson(request))) {
    throw new Error("模板注册表读取内容与签名不一致");
  }
}

function sameScope(left: TemplateRegistryScope, right: TemplateRegistryScope): boolean {
  return left.tenantKey === right.tenantKey
    && left.baseToken === right.baseToken
    && left.tableId === right.tableId;
}

function storageKey(scope: TemplateRegistryScope, id: string, revision: string): string {
  return canonicalJson([scope.tenantKey, scope.baseToken, scope.tableId, id, revision]);
}

export function createInMemoryTemplateRegistryStore(): TemplateRegistryStore {
  const templates = new Map<string, RegisteredAutomationTemplate>();
  return {
    async upsert(template) {
      const safe = sanitizeAutomationTemplateSnapshot(template);
      for (const [key, candidate] of templates) {
        if (sameScope(candidate, safe) && candidate.id === safe.id) templates.delete(key);
      }
      templates.set(storageKey(safe, safe.id, safe.revision), safe);
    },
    async list(scope) {
      return [...templates.values()]
        .filter((item) => sameScope(item, scope) && item.status === "ready")
        .map((item) => sanitizeAutomationTemplateSnapshot(item));
    },
    async get(scope, selection) {
      const item = templates.get(storageKey(scope, selection.id, selection.revision));
      return item && sameScope(item, scope)
        ? sanitizeAutomationTemplateSnapshot(item)
        : null;
    },
  };
}

export function createAuthenticatedTemplateRegistry(options: RegistryOptions): AuthenticatedTemplateRegistry {
  const store = options.store ?? createInMemoryTemplateRegistryStore();
  const now = options.now ?? Date.now;
  return {
    async upsert(body: RegistryWriteRequest, authorization: string): Promise<void> {
      await verifyRegistryWriteRequest(body, authorization, options.signingSecret, now());
      const snapshot = sanitizeAutomationTemplateSnapshot(body.template.snapshot);
      const item: RegisteredAutomationTemplate = {
        ...body.scope,
        ...body.template,
        snapshot,
        referencedFieldIds: [...body.template.referencedFieldIds],
        status: body.template.status === "deleted" ? "deleted" : "ready",
      };
      await store.upsert(item);
    },
    async list(scope: TemplateRegistryScope): Promise<RegisteredAutomationTemplate[]> {
      return (await store.list(scope))
        .filter((item) => sameScope(item, scope) && item.status === "ready")
        .map((item) => sanitizeAutomationTemplateSnapshot(item));
    },
    async get(
      scope: TemplateRegistryScope,
      selection: TemplateSelection,
    ): Promise<RegisteredAutomationTemplate | null> {
      const item = await store.get(scope, selection);
      return item && sameScope(item, scope) ? sanitizeAutomationTemplateSnapshot(item) : null;
    },
  };
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [已隐藏]")
    .replace(/((?:tenant|user)[_-]?access[_-]?token\s*[=:]\s*)[^\s,;]+/gi, "$1[已隐藏]")
    .slice(0, 500)
    .trim() || "模板注册表请求失败";
}

function registryError(status: number, code: string, message: string, traceId: string): Response {
  return new Response(JSON.stringify({ success: false, code, message, traceId }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-duowei-trace-id": traceId,
    },
  });
}

function registrySignature(request: Request): string | null {
  return request.headers.get("x-duowei-service-signature")?.trim() || null;
}

export function createTemplateRegistryHttpHandler(options: {
  registry: Pick<AuthenticatedTemplateRegistry, "upsert"> & Partial<Pick<AuthenticatedTemplateRegistry, "list" | "get">>;
  readSigningSecret?: Uint8Array;
  now?: () => number;
  maxRequestBytes?: number;
}): (request: Request) => Promise<Response> {
  const maxRequestBytes = options.maxRequestBytes ?? 2 * 1024 * 1024;
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1) {
    throw new Error("模板注册表请求大小上限无效");
  }
  return async (request) => {
    const traceId = portableNonce();
    if (request.method !== "POST") {
      return registryError(405, "METHOD_NOT_ALLOWED", "模板注册表只接受 POST 请求", traceId);
    }
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return registryError(415, "CONTENT_TYPE_INVALID", "模板注册表请求必须使用 JSON", traceId);
    }
    const authorization = registrySignature(request);
    if (!authorization) {
      return registryError(401, "AUTH_REQUIRED", "模板注册表请求缺少身份签名", traceId);
    }
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxRequestBytes) {
      return registryError(413, "REQUEST_TOO_LARGE", "模板注册表请求超过大小限制", traceId);
    }
    const rawBody = await request.text();
    if (utf8Bytes(rawBody).byteLength > maxRequestBytes) {
      return registryError(413, "REQUEST_TOO_LARGE", "模板注册表请求超过大小限制", traceId);
    }
    let untrusted: unknown;
    try {
      untrusted = JSON.parse(rawBody) as unknown;
    } catch {
      return registryError(400, "JSON_INVALID", "模板注册表请求不是有效 JSON", traceId);
    }
    if (untrusted && typeof untrusted === "object" && !Array.isArray(untrusted)
      && "operation" in untrusted) {
      if (!options.readSigningSecret || !options.registry.list || !options.registry.get) {
        return registryError(503, "READ_NOT_CONFIGURED", "模板注册表读取服务尚未配置", traceId);
      }
      try {
        const body = parseRegistryReadRequest(untrusted);
        await verifyRegistryReadRequest(
          body,
          authorization,
          options.readSigningSecret,
          (options.now ?? Date.now)(),
        );
        const payload = body.operation === "list"
          ? { templates: await options.registry.list(body.scope) }
          : { template: await options.registry.get(body.scope, body.selection) };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "x-duowei-trace-id": traceId,
          },
        });
      } catch (error) {
        return registryError(401, "READ_AUTH_INVALID", safeErrorMessage(error), traceId);
      }
    }
    const body = untrusted as RegistryWriteRequest;
    try {
      await options.registry.upsert(body, authorization);
      return new Response(null, {
        status: 204,
        headers: { "x-duowei-trace-id": traceId },
      });
    } catch (error) {
      const message = safeErrorMessage(error);
      const authenticationError = /身份|签名|过期|写入权限|作用域/.test(message);
      return registryError(
        authenticationError ? 401 : 400,
        authenticationError ? "AUTH_INVALID" : "TEMPLATE_INVALID",
        message,
        traceId,
      );
    }
  };
}

export function createTemplateRegistryHttpTransport(options: {
  endpoint: string;
  fetch?: RegistryFetch;
}): { upsert(body: RegistryWriteRequest, authorization: string): Promise<void> } {
  const fetcher = options.fetch ?? fetch;
  return {
    async upsert(body, authorization) {
      if (!authorization.trim()) throw new Error("模板注册表身份签名为空");
      const response = await fetcher(options.endpoint, {
        method: "POST",
        headers: {
          "x-duowei-service-signature": authorization,
          "content-type": "application/json",
        },
        body: canonicalJson(body),
      });
      if (response.ok) return;
      let details: { message?: string; code?: string; traceId?: string } = {};
      try {
        details = await response.json() as typeof details;
      } catch {
        // Preserve the HTTP status when an upstream proxy did not return JSON.
      }
      const message = safeErrorMessage(details.message ?? response.statusText);
      const trace = details.traceId ? `（traceId: ${details.traceId}）` : "";
      throw new Error(`${details.code ?? `HTTP_${response.status}`}：${message}${trace}`);
    },
  };
}

export function createTemplateRegistryHttpReader(options: {
  endpoint: string;
  authorization?: string;
  signingSecret: Uint8Array;
  fetch?: RegistryFetch;
  now?: () => number;
}): Pick<AuthenticatedTemplateRegistry, "list" | "get"> {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const read = async (request: RegistryReadRequest): Promise<Record<string, unknown>> => {
    const body = parseRegistryReadRequest(request);
    const token = await signRegistryReadRequest(body, options.signingSecret, now());
    const response = await fetcher(options.endpoint, {
      method: "POST",
      headers: {
        ...(options.authorization ? { authorization: options.authorization } : {}),
        "x-duowei-service-signature": token,
        "content-type": "application/json",
      },
      body: canonicalJson(body),
    });
    if (!response.ok) {
      let details: { message?: string; code?: string; traceId?: string } = {};
      try {
        details = await response.json() as typeof details;
      } catch {
        // Preserve the HTTP status if an upstream proxy returned another format.
      }
      const trace = details.traceId ? `（traceId: ${details.traceId}）` : "";
      throw new Error(`${details.code ?? `HTTP_${response.status}`}：${safeErrorMessage(details.message ?? response.statusText)}${trace}`);
    }
    const payload = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("模板注册表读取响应无效");
    }
    return payload as Record<string, unknown>;
  };
  return {
    async list(scope) {
      const payload = await read({ operation: "list", scope });
      if (!Array.isArray(payload.templates)) throw new Error("模板注册表列表响应无效");
      return payload.templates.map((item) => sanitizeAutomationTemplateSnapshot(item)) as RegisteredAutomationTemplate[];
    },
    async get(scope, selection) {
      const payload = await read({ operation: "get", scope, selection });
      if (payload.template === null) return null;
      return sanitizeAutomationTemplateSnapshot(payload.template) as RegisteredAutomationTemplate;
    },
  };
}
