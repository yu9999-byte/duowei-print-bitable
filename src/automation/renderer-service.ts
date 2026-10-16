import type { AutomationRenderRequest } from "./automation-domain.ts";
import {
  createIdempotentArtifactCache,
  validateRenderedArtifact,
  type IdempotentArtifactCache,
  type RenderedArtifact,
} from "./automation-artifact.ts";
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

type RendererFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type RendererServiceOptions = {
  signingSecret: Uint8Array;
  render(request: AutomationRenderRequest, signal?: AbortSignal): Promise<RenderedArtifact>;
  now?: () => number;
  timeoutMs?: number;
  maxRequestBytes?: number;
  cache?: IdempotentArtifactCache;
};

type RendererClientOptions = {
  endpoint: string;
  authorization?: string;
  signingSecret: Uint8Array;
  fetch?: RendererFetch;
  now?: () => number;
};

type SignedRendererClaims = {
  version: 1;
  audience: "duowei-renderer";
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  artifactKey: string;
  bodyDigest: string;
};

type ErrorStage = "request" | "authentication" | "render" | "response";

class RendererServiceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly stage: ErrorStage;

  constructor(
    status: number,
    code: string,
    stage: ErrorStage,
    message: string,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.stage = stage;
  }
}

const TOKEN_PREFIX = "duowei-renderer-v1";
const MAX_TOKEN_AGE_MS = 5 * 60_000;
const DEFAULT_MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const SENSITIVE_KEYS = new Set([
  "authorization",
  "appsecret",
  "clientsecret",
  "password",
  "refreshtoken",
  "tenantaccesstoken",
  "useraccesstoken",
]);

function normalizedKey(key: string): string {
  return key.replace(/[-_]/g, "").toLowerCase();
}

function canonicalJson(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== "object") throw new Error("渲染请求包含不可序列化数据");
  if (seen.has(value)) throw new Error("渲染请求包含循环引用");
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
  if (secret.byteLength < 32) throw new Error("渲染服务签名密钥长度不足");
  return hmacSha256(secret, payload);
}

async function verifyHmac(
  secret: Uint8Array,
  payload: string,
  signature: Uint8Array,
): Promise<boolean> {
  if (secret.byteLength < 32) throw new Error("渲染服务签名密钥长度不足");
  return constantTimeEqual(hmacSha256(secret, payload), signature);
}

function requirePlainObject(label: string, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}必须是对象`);
  }
  return value as Record<string, unknown>;
}

function requireString(label: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}不能为空`);
  return value.trim();
}

function assertExactKeys(label: string, value: Record<string, unknown>, keys: readonly string[]): void {
  const allowed = new Set(keys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) throw new Error(`${label}包含不支持的属性：${unexpected.join("、")}`);
}

function assertNoCredentials(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object") throw new Error("渲染请求包含不可序列化数据");
  if (seen.has(value)) throw new Error("渲染请求包含循环引用");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertNoCredentials(item, seen);
  } else {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const normalized = normalizedKey(key);
      if (SENSITIVE_KEYS.has(normalized) || normalized.endsWith("accesstoken")) {
        throw new Error(`渲染请求包含不允许外发的凭据属性：${key}`);
      }
      assertNoCredentials(item, seen);
    }
  }
  seen.delete(value);
}

function parseRenderRequest(value: unknown): AutomationRenderRequest {
  assertNoCredentials(value);
  const root = requirePlainObject("渲染请求", value);
  assertExactKeys("渲染请求", root, ["artifactKey", "template", "values", "output"]);
  const artifactKey = requireString("产物键", root.artifactKey);
  if (!artifactKey.startsWith("duowei:v1:")) throw new Error("产物键格式无效");

  const template = requirePlainObject("模板", root.template);
  assertExactKeys("模板", template, ["id", "revision", "snapshot"]);
  const id = requireString("模板 ID", template.id);
  const revision = requireString("模板修订", template.revision);
  canonicalJson(template.snapshot);

  const values = requirePlainObject("字段值", root.values);
  if (Object.keys(values).length > 500) throw new Error("渲染请求引用字段过多");
  canonicalJson(values);

  const output = requirePlainObject("输出设置", root.output);
  assertExactKeys("输出设置", output, ["type", "pageLimit"]);
  if (output.type !== "pdf" && output.type !== "png") throw new Error("自动化输出类型无效");
  if (output.type === "pdf" && output.pageLimit !== null) {
    throw new Error("PDF 自动化产物必须输出完整多页文件");
  }
  if (output.type === "png" && output.pageLimit !== 1) {
    throw new Error("PNG 自动化产物仅允许输出第一页");
  }

  return JSON.parse(canonicalJson({
    artifactKey,
    template: { id, revision, snapshot: template.snapshot },
    values,
    output: { type: output.type, pageLimit: output.pageLimit },
  })) as AutomationRenderRequest;
}

export async function signRendererRequest(
  request: AutomationRenderRequest,
  secret: Uint8Array,
  now = Date.now(),
): Promise<string> {
  const body = parseRenderRequest(request);
  const claims: SignedRendererClaims = {
    version: 1,
    audience: "duowei-renderer",
    issuedAt: now,
    expiresAt: now + MAX_TOKEN_AGE_MS,
    nonce: portableNonce(),
    artifactKey: body.artifactKey,
    bodyDigest: await sha256(canonicalJson(body)),
  };
  const encodedClaims = base64UrlEncode(utf8Bytes(canonicalJson(claims)));
  const signature = base64UrlEncode(await hmac(secret, `${TOKEN_PREFIX}.${encodedClaims}`));
  return `${TOKEN_PREFIX}.${encodedClaims}.${signature}`;
}

async function verifyRendererRequest(
  body: AutomationRenderRequest,
  token: string,
  secret: Uint8Array,
  now: number,
): Promise<void> {
  const [prefix, encodedClaims, encodedSignature, extra] = token.split(".");
  if (prefix !== TOKEN_PREFIX || !encodedClaims || !encodedSignature || extra) {
    throw new Error("渲染服务身份签名无效");
  }
  let signature: Uint8Array;
  try {
    signature = base64UrlDecode(encodedSignature);
  } catch {
    throw new Error("渲染服务身份签名无效");
  }
  if (!await verifyHmac(secret, `${prefix}.${encodedClaims}`, signature)) {
    throw new Error("渲染服务身份签名无效");
  }
  let claims: SignedRendererClaims;
  try {
    claims = JSON.parse(utf8String(base64UrlDecode(encodedClaims))) as SignedRendererClaims;
  } catch {
    throw new Error("渲染服务身份签名无效");
  }
  if (claims.version !== 1 || claims.audience !== "duowei-renderer") {
    throw new Error("渲染服务身份签名无效");
  }
  if (claims.expiresAt < now || claims.issuedAt > now + 30_000) {
    throw new Error("渲染服务身份签名已过期");
  }
  if (claims.artifactKey !== body.artifactKey) throw new Error("渲染服务产物键与签名不一致");
  if (claims.bodyDigest !== await sha256(canonicalJson(body))) {
    throw new Error("渲染请求内容与签名不一致");
  }
}

function serviceSignature(request: Request): string {
  const signature = request.headers.get("x-duowei-service-signature")?.trim();
  if (!signature) throw new RendererServiceError(401, "AUTH_REQUIRED", "authentication", "渲染请求缺少服务身份签名");
  return signature;
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [已隐藏]")
    .replace(/((?:tenant|user)[_-]?access[_-]?token\s*[=:]\s*)[^\s,;]+/gi, "$1[已隐藏]")
    .slice(0, 500)
    .trim() || "渲染失败，请重试";
}

function jsonError(error: RendererServiceError, traceId: string): Response {
  return new Response(JSON.stringify({
    success: false,
    traceId,
    stage: error.stage,
    code: error.code,
    message: safeMessage(error),
  }), {
    status: error.status,
    headers: { "content-type": "application/json; charset=utf-8", "x-duowei-trace-id": traceId },
  });
}

function timeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new RendererServiceError(
        504,
        "RENDER_TIMEOUT",
        "render",
        "生成文件超时，请稍后重试",
      ));
    }, timeoutMs);
  });
  return Promise.race([operation(controller.signal), expired]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function artifactResponse(artifact: RenderedArtifact, traceId: string): Response {
  const bytes = artifact.bytes.slice().buffer as ArrayBuffer;
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": artifact.contentType,
      "content-length": String(artifact.bytes.byteLength),
      "x-duowei-artifact-key": artifact.artifactKey,
      "x-duowei-file-name": encodeURIComponent(artifact.fileName),
      "x-duowei-page-count": String(artifact.pageCount),
      "x-duowei-trace-id": traceId,
    },
  });
}

export function createRendererHttpHandler(
  options: RendererServiceOptions,
): (request: Request) => Promise<Response> {
  const now = options.now ?? Date.now;
  const maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cache = options.cache ?? createIdempotentArtifactCache();
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1) {
    throw new Error("渲染服务请求大小上限无效");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("渲染服务超时上限无效");

  return async (request) => {
    const traceId = portableNonce();
    try {
      if (request.method !== "POST") {
        throw new RendererServiceError(405, "METHOD_NOT_ALLOWED", "request", "渲染服务只接受 POST 请求");
      }
      if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
        throw new RendererServiceError(415, "CONTENT_TYPE_INVALID", "request", "渲染请求必须使用 JSON");
      }
      const declaredLength = Number(request.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > maxRequestBytes) {
        throw new RendererServiceError(413, "REQUEST_TOO_LARGE", "request", "渲染请求超过大小限制");
      }
      const rawBody = await request.text();
      if (utf8Bytes(rawBody).byteLength > maxRequestBytes) {
        throw new RendererServiceError(413, "REQUEST_TOO_LARGE", "request", "渲染请求超过大小限制");
      }
      let untrusted: unknown;
      try {
        untrusted = JSON.parse(rawBody);
      } catch {
        throw new RendererServiceError(400, "JSON_INVALID", "request", "渲染请求不是有效 JSON");
      }
      let body: AutomationRenderRequest;
      try {
        body = parseRenderRequest(untrusted);
      } catch (error) {
        throw new RendererServiceError(400, "REQUEST_INVALID", "request", safeMessage(error));
      }
      try {
        await verifyRendererRequest(body, serviceSignature(request), options.signingSecret, now());
      } catch (error) {
        if (error instanceof RendererServiceError) throw error;
        throw new RendererServiceError(401, "AUTH_INVALID", "authentication", safeMessage(error));
      }

      const artifact = await cache.getOrCreate(body.artifactKey, () => timeout(
        (signal) => Promise.resolve().then(() => options.render(body, signal)),
        timeoutMs,
      ));
      let valid: RenderedArtifact;
      try {
        valid = validateRenderedArtifact(body.artifactKey, body.output.type, artifact);
      } catch (error) {
        throw new RendererServiceError(502, "ARTIFACT_INVALID", "response", safeMessage(error));
      }
      return artifactResponse(valid, traceId);
    } catch (error) {
      if (error instanceof RendererServiceError) return jsonError(error, traceId);
      return jsonError(new RendererServiceError(
        502,
        "RENDER_FAILED",
        "render",
        safeMessage(error),
      ), traceId);
    }
  };
}

function requiredHeader(response: Response, name: string): string {
  const value = response.headers.get(name)?.trim();
  if (!value) throw new Error(`渲染服务响应缺少 ${name}`);
  return value;
}

export function createRendererHttpClient(options: RendererClientOptions): {
  render(request: AutomationRenderRequest): Promise<RenderedArtifact>;
} {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  return {
    async render(request) {
      const body = parseRenderRequest(request);
      const token = await signRendererRequest(body, options.signingSecret, now());
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
        let details: { code?: string; message?: string; traceId?: string } = {};
        try {
          details = await response.json() as typeof details;
        } catch {
          // The status remains useful when an upstream proxy does not preserve JSON.
        }
        const code = details.code ?? `HTTP_${response.status}`;
        const trace = details.traceId ? `（traceId: ${details.traceId}）` : "";
        throw new Error(`渲染服务 ${code}：${safeMessage(details.message ?? response.statusText)}${trace}`);
      }
      const artifactKey = requiredHeader(response, "x-duowei-artifact-key");
      const encodedName = requiredHeader(response, "x-duowei-file-name");
      const pageCount = Number(requiredHeader(response, "x-duowei-page-count"));
      let fileName: string;
      try {
        fileName = decodeURIComponent(encodedName);
      } catch {
        throw new Error("渲染服务返回了无效文件名");
      }
      const artifact: RenderedArtifact = {
        artifactKey,
        fileName,
        contentType: requiredHeader(response, "content-type").split(";", 1)[0].trim(),
        pageCount,
        bytes: new Uint8Array(await response.arrayBuffer()),
      };
      return validateRenderedArtifact(body.artifactKey, body.output.type, artifact);
    },
  };
}
