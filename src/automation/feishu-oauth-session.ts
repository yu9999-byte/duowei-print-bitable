import { RegistryConnectionRequiredError } from "./registry-write-authorization.ts";
import type {
  RegistryWriteDraftRequest,
  RegistryWriteIdentity,
} from "./template-registry-service.ts";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type Scope = RegistryWriteDraftRequest["scope"];

type PendingAuthorization = {
  state: string;
  codeVerifier: string;
  origin: string;
  scope: Scope;
  expiresAt: number;
};

type Session = RegistryWriteIdentity & {
  expiresAt: number;
};

export type FeishuOAuthSessionOptions = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  serviceBaseUrl: string;
  allowedOrigins: readonly string[];
  fetch?: FetchLike;
  now?: () => number;
  pendingTtlMs?: number;
  sessionTtlMs?: number;
  tokenEndpoint?: string;
};

export type FeishuOAuthSessionService = {
  verifyIdentity(request: Request, body: RegistryWriteDraftRequest): Promise<RegistryWriteIdentity>;
  handleStart(request: Request): Promise<Response>;
  handleCallback(request: Request): Promise<Response>;
};

const COOKIE_NAME = "__Host-duowei_oauth_session";
const OAUTH_SCOPE = "bitable:app";
const AUTHORIZATION_ENDPOINT = "https://accounts.feishu.cn/open-apis/authen/v1/authorize";
const DEFAULT_TOKEN_ENDPOINT = "https://accounts.feishu.cn/oauth/v3/token";
const USER_INFO_ENDPOINT = "https://open.feishu.cn/open-apis/authen/v1/user_info";

function requiredSecret(label: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label}不能为空`);
  return normalized;
}

function httpsUrl(label: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label}不是有效 URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error(`${label}必须是无凭据、无片段的 HTTPS URL`);
  }
  return url;
}

function originValue(label: string, value: string): string {
  const url = httpsUrl(label, value);
  if (url.pathname !== "/" || url.search) throw new Error(`${label}必须只包含来源`);
  return url.origin;
}

function randomToken(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  ));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function cookieValue(request: Request, name: string): string | null {
  const cookies = request.headers.get("cookie") ?? "";
  for (const item of cookies.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    const value = item.slice(separator + 1).trim();
    return value || null;
  }
  return null;
}

function plainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeMessage(value: unknown, fallback: string): string {
  const message = typeof value === "string" ? value : fallback;
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [已隐藏]")
    .replace(/((?:client[_-]?secret|access[_-]?token)\s*[=:]\s*)[^\s,;]+/gi, "$1[已隐藏]")
    .slice(0, 300);
}

function sameScope(left: Scope, right: Scope): boolean {
  return left.baseToken === right.baseToken && left.tableId === right.tableId;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function callbackHtml(
  origin: string | null,
  message: { type: "duowei-print:oauth-connected" | "duowei-print:oauth-failed"; message?: string },
  status: number,
  cookie?: string,
): Response {
  const nonce = randomToken(18);
  const targetOrigin = origin ?? "https://invalid.local";
  const title = message.type === "duowei-print:oauth-connected" ? "连接成功" : "连接失败";
  const body = message.type === "duowei-print:oauth-connected"
    ? "已连接多维打印自动化，可以关闭此窗口。"
    : safeMessage(message.message, "连接未完成，请关闭窗口后重试。");
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title>`
    + `<style nonce="${nonce}">body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f6f7;color:#1f2329}.box{max-width:360px;padding:24px}h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#646a73;line-height:1.6}</style>`
    + `</head><body><main class="box"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></main>`
    + `<script nonce="${nonce}">window.opener?.postMessage(${scriptJson(message)},${scriptJson(targetOrigin)});`
    + `if(${scriptJson(message.type === "duowei-print:oauth-connected")})setTimeout(()=>window.close(),250);</script>`
    + `</body></html>`, { status, headers });
}

async function jsonObject(response: Response, label: string): Promise<Record<string, unknown>> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${label}没有返回有效 JSON`);
  }
  const object = plainObject(payload);
  if (!object) throw new Error(`${label}返回格式无效`);
  return object;
}

export function createFeishuOAuthSessionService(
  options: FeishuOAuthSessionOptions,
): FeishuOAuthSessionService {
  const clientId = requiredSecret("飞书 App ID", options.clientId);
  const clientSecret = requiredSecret("飞书 App Secret", options.clientSecret);
  const redirectUri = httpsUrl("飞书 OAuth 回调地址", options.redirectUri).toString();
  const serviceBaseUrl = httpsUrl("自动化服务地址", options.serviceBaseUrl);
  const tokenEndpoint = httpsUrl(
    "飞书 OAuth Token 地址",
    options.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT,
  ).toString();
  const allowedOrigins = new Set(options.allowedOrigins.map((origin) => (
    originValue("记录视图允许来源", origin)
  )));
  if (allowedOrigins.size === 0) throw new Error("至少需要一个记录视图允许来源");
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const pendingTtlMs = options.pendingTtlMs ?? 5 * 60_000;
  const sessionTtlMs = options.sessionTtlMs ?? 2 * 60 * 60_000;
  if (!Number.isSafeInteger(pendingTtlMs) || pendingTtlMs < 60_000) {
    throw new Error("OAuth state 有效期无效");
  }
  if (!Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 60_000) {
    throw new Error("OAuth 会话有效期无效");
  }

  const pending = new Map<string, PendingAuthorization>();
  const sessions = new Map<string, Session>();

  const purge = () => {
    const timestamp = now();
    for (const [key, item] of pending) if (item.expiresAt <= timestamp) pending.delete(key);
    for (const [key, item] of sessions) if (item.expiresAt <= timestamp) sessions.delete(key);
  };

  const trustedOrigin = (request: Request): string => {
    const origin = request.headers.get("origin")?.trim() ?? "";
    if (!allowedOrigins.has(origin)) throw new Error("模板同步请求来源不受信任");
    return origin;
  };

  const createRequired = async (origin: string, scope: Scope): Promise<RegistryConnectionRequiredError> => {
    purge();
    const state = randomToken();
    pending.set(state, {
      state,
      codeVerifier: randomToken(48),
      origin,
      scope: { ...scope },
      expiresAt: now() + pendingTtlMs,
    });
    const connectUrl = new URL("/v1/oauth/start", serviceBaseUrl);
    connectUrl.searchParams.set("state", state);
    return new RegistryConnectionRequiredError(connectUrl.toString());
  };

  const verifyIdentity = async (
    request: Request,
    body: RegistryWriteDraftRequest,
  ): Promise<RegistryWriteIdentity> => {
    const origin = trustedOrigin(request);
    purge();
    const sessionId = cookieValue(request, COOKIE_NAME);
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session || !sameScope(session, body.scope)) {
      throw await createRequired(origin, body.scope);
    }
    return {
      principalId: session.principalId,
      tenantKey: session.tenantKey,
      baseToken: session.baseToken,
      tableId: session.tableId,
      canWrite: session.canWrite,
    };
  };

  const handleStart = async (request: Request): Promise<Response> => {
    purge();
    const state = new URL(request.url).searchParams.get("state")?.trim() ?? "";
    const item = pending.get(state);
    if (!item) return callbackHtml(null, {
      type: "duowei-print:oauth-failed",
      message: "连接请求已失效，请返回多维打印后重试。",
    }, 400);
    const authorization = new URL(AUTHORIZATION_ENDPOINT);
    authorization.searchParams.set("client_id", clientId);
    authorization.searchParams.set("response_type", "code");
    authorization.searchParams.set("redirect_uri", redirectUri);
    authorization.searchParams.set("scope", OAUTH_SCOPE);
    authorization.searchParams.set("state", item.state);
    authorization.searchParams.set("code_challenge", await codeChallenge(item.codeVerifier));
    authorization.searchParams.set("code_challenge_method", "S256");
    return new Response(null, {
      status: 302,
      headers: {
        location: authorization.toString(),
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  };

  const handleCallback = async (request: Request): Promise<Response> => {
    purge();
    const url = new URL(request.url);
    const state = url.searchParams.get("state")?.trim() ?? "";
    const item = pending.get(state);
    if (!item) return callbackHtml(null, {
      type: "duowei-print:oauth-failed",
      message: "连接请求已失效，请返回多维打印后重试。",
    }, 400);
    pending.delete(state);
    if (url.searchParams.get("error")) {
      return callbackHtml(item.origin, {
        type: "duowei-print:oauth-failed",
        message: "你取消了飞书授权，自动化模板尚未连接。",
      }, 400);
    }
    const code = url.searchParams.get("code")?.trim() ?? "";
    if (!code) return callbackHtml(item.origin, {
      type: "duowei-print:oauth-failed",
      message: "飞书回调缺少授权码，请重新连接。",
    }, 400);

    try {
      const tokenBody = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        code_verifier: item.codeVerifier,
      });
      const tokenResponse = await fetcher(tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: tokenBody.toString(),
      });
      const token = await jsonObject(tokenResponse, "飞书 OAuth Token 接口");
      const accessToken = typeof token.access_token === "string" ? token.access_token.trim() : "";
      const expiresIn = typeof token.expires_in === "number" ? token.expires_in : 0;
      if (!tokenResponse.ok || token.code !== 0 || !accessToken || expiresIn <= 0) {
        throw new Error(safeMessage(
          token.error_description ?? token.msg,
          "飞书没有签发有效用户令牌",
        ));
      }

      const authorization = `Bearer ${accessToken}`;
      const userResponse = await fetcher(USER_INFO_ENDPOINT, {
        headers: { authorization },
      });
      const userPayload = await jsonObject(userResponse, "飞书用户信息接口");
      const user = plainObject(userPayload.data);
      const principalId = typeof user?.open_id === "string" ? user.open_id.trim() : "";
      const tenantKey = typeof user?.tenant_key === "string" ? user.tenant_key.trim() : "";
      if (!userResponse.ok || userPayload.code !== 0 || !principalId || !tenantKey) {
        throw new Error(safeMessage(userPayload.msg, "飞书用户身份无效"));
      }

      const permissionUrl = new URL(
        `/open-apis/drive/v1/permissions/${encodeURIComponent(item.scope.baseToken)}/members/auth`,
        "https://open.feishu.cn",
      );
      permissionUrl.searchParams.set("type", "bitable");
      permissionUrl.searchParams.set("action", "edit");
      const permissionResponse = await fetcher(permissionUrl, { headers: { authorization } });
      const permissionPayload = await jsonObject(permissionResponse, "飞书文档权限接口");
      const permission = plainObject(permissionPayload.data);
      if (!permissionResponse.ok || permissionPayload.code !== 0 || permission?.auth_result !== true) {
        return callbackHtml(item.origin, {
          type: "duowei-print:oauth-failed",
          message: "当前飞书用户没有此多维表格的编辑权限，不能同步自动化模板。",
        }, 403);
      }

      const sessionId = randomToken(48);
      const lifetime = Math.max(60_000, Math.min(sessionTtlMs, expiresIn * 1000 - 30_000));
      sessions.set(sessionId, {
        principalId,
        tenantKey,
        ...item.scope,
        canWrite: true,
        expiresAt: now() + lifetime,
      });
      const maxAge = Math.floor(lifetime / 1000);
      return callbackHtml(item.origin, { type: "duowei-print:oauth-connected" }, 200,
        `${COOKIE_NAME}=${sessionId}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None`);
    } catch (error) {
      return callbackHtml(item.origin, {
        type: "duowei-print:oauth-failed",
        message: safeMessage(error instanceof Error ? error.message : error, "飞书连接失败"),
      }, 502);
    }
  };

  return { verifyIdentity, handleStart, handleCallback };
}
