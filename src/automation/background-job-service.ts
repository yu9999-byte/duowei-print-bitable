import {
  canonicalAutomationJson,
  normalizeBackgroundJobSubmission,
  type BackgroundJobStore,
  type BackgroundJobSubmission,
} from "./background-job.ts";
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

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type Claims = {
  version: 1;
  audience: "duowei-background-job";
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  taskKey: string;
  bodyDigest: string;
};

const PREFIX = "duowei-background-job-v1";
const MAX_AGE_MS = 5 * 60_000;

async function digest(value: string): Promise<string> {
  return sha256Base64Url(value);
}

async function hmac(secret: Uint8Array, payload: string, operation: "sign" | "verify", signature?: Uint8Array): Promise<Uint8Array | boolean> {
  if (secret.byteLength < 32) throw new Error("后台任务签名密钥长度不足");
  const expected = hmacSha256(secret, payload);
  return operation === "sign" ? expected : constantTimeEqual(expected, signature ?? new Uint8Array());
}

export async function signBackgroundJobRequest(
  body: BackgroundJobSubmission,
  secret: Uint8Array,
  now = Date.now(),
): Promise<string> {
  const normalized = normalizeBackgroundJobSubmission(body);
  const claims: Claims = {
    version: 1,
    audience: "duowei-background-job",
    issuedAt: now,
    expiresAt: now + MAX_AGE_MS,
    nonce: portableNonce(),
    taskKey: normalized.taskKey,
    bodyDigest: await digest(canonicalAutomationJson(normalized)),
  };
  const encoded = base64UrlEncode(utf8Bytes(canonicalAutomationJson(claims)));
  const signature = await hmac(secret, `${PREFIX}.${encoded}`, "sign") as Uint8Array;
  return `${PREFIX}.${encoded}.${base64UrlEncode(signature)}`;
}

async function verify(body: BackgroundJobSubmission, token: string, secret: Uint8Array, now: number): Promise<void> {
  const [prefix, encoded, encodedSignature, extra] = token.split(".");
  if (prefix !== PREFIX || !encoded || !encodedSignature || extra) throw new Error("后台任务签名无效");
  const valid = await hmac(secret, `${prefix}.${encoded}`, "verify", base64UrlDecode(encodedSignature));
  if (!valid) throw new Error("后台任务签名无效");
  let claims: Claims;
  try {
    claims = JSON.parse(utf8String(base64UrlDecode(encoded))) as Claims;
  } catch {
    throw new Error("后台任务签名无效");
  }
  if (claims.version !== 1 || claims.audience !== "duowei-background-job") throw new Error("后台任务签名无效");
  if (claims.expiresAt < now || claims.issuedAt > now + 30_000) throw new Error("后台任务签名已过期");
  if (claims.taskKey !== body.taskKey) throw new Error("后台任务键与签名不一致");
  if (claims.bodyDigest !== await digest(canonicalAutomationJson(body))) throw new Error("后台任务内容与签名不一致");
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+\S+/gi, "Bearer [已隐藏]").slice(0, 500).trim();
}

export function createBackgroundJobHttpHandler(options: {
  store: BackgroundJobStore;
  signingSecret: Uint8Array;
  now?: () => number;
  maxRequestBytes?: number;
}): (request: Request) => Promise<Response> {
  const now = options.now ?? Date.now;
  const maxRequestBytes = options.maxRequestBytes ?? 2 * 1024 * 1024;
  return async (request) => {
    const traceId = portableNonce();
    try {
      if (request.method !== "POST") return Response.json({ success: false, code: "METHOD_NOT_ALLOWED" }, { status: 405 });
      if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
        return Response.json({ success: false, code: "CONTENT_TYPE_INVALID" }, { status: 415 });
      }
      const raw = await request.text();
      if (utf8Bytes(raw).byteLength > maxRequestBytes) {
        return Response.json({ success: false, code: "REQUEST_TOO_LARGE" }, { status: 413 });
      }
      const body = normalizeBackgroundJobSubmission(JSON.parse(raw));
      const token = request.headers.get("x-duowei-service-signature")?.trim() ?? "";
      await verify(body, token, options.signingSecret, now());
      const existing = await options.store.get(body.taskKey);
      const job = await options.store.createOrGet(body);
      return Response.json({
        jobId: job.jobId,
        status: job.status,
        reused: Boolean(existing),
        traceId,
      }, { status: existing ? 200 : 202, headers: { "x-duowei-trace-id": traceId } });
    } catch (error) {
      const message = safeMessage(error);
      const authentication = /签名|过期/.test(message);
      return Response.json({
        success: false,
        code: authentication ? "AUTH_INVALID" : "JOB_INVALID",
        message,
        traceId,
      }, { status: authentication ? 401 : 400, headers: { "x-duowei-trace-id": traceId } });
    }
  };
}

export function createBackgroundJobHttpClient(options: {
  endpoint: string;
  authorization?: string;
  tenantAccessToken?: string;
  signingSecret: Uint8Array;
  fetch?: FetchLike;
  now?: () => number;
}): { submit(body: BackgroundJobSubmission): Promise<{ jobId: string; status: string; reused: boolean }> } {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  return {
    async submit(untrusted) {
      const body = normalizeBackgroundJobSubmission(untrusted);
      const signature = await signBackgroundJobRequest(body, options.signingSecret, now());
      const response = await fetcher(options.endpoint, {
        method: "POST",
        headers: {
          ...(options.authorization ? { authorization: options.authorization } : {}),
          ...(options.tenantAccessToken ? { "x-duowei-tenant-access-token": options.tenantAccessToken } : {}),
          "content-type": "application/json",
          "x-duowei-service-signature": signature,
        },
        body: canonicalAutomationJson(body),
      });
      let payload: unknown;
      try { payload = await response.json(); } catch { payload = null; }
      if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload)) {
        const details = payload as { code?: string; message?: string } | null;
        throw new Error(`后台任务 ${details?.code ?? `HTTP_${response.status}`}：${safeMessage(details?.message ?? response.statusText)}`);
      }
      const details = payload as Record<string, unknown>;
      if (typeof details.jobId !== "string" || typeof details.status !== "string") throw new Error("后台任务响应无效");
      return { jobId: details.jobId, status: details.status, reused: details.reused === true };
    },
  };
}
