type HttpHandler = (request: Request) => Promise<Response>;

export type AutomationServiceOptions = {
  allowedOrigins: readonly string[];
  oauthStart: HttpHandler;
  oauthCallback: HttpHandler;
  registryAuthorization: HttpHandler;
  templateRegistry: HttpHandler;
  renderer: HttpHandler;
  backgroundJobs: HttpHandler;
  feishuEvents: HttpHandler;
};

type Route = {
  method: "GET" | "POST";
  handler: HttpHandler;
  cors?: boolean;
};

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ success: false, code, message }, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function appendVary(headers: Headers, value: string): void {
  const current = headers.get("vary");
  const values = new Set((current ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  values.add(value);
  headers.set("vary", [...values].join(", "));
}

function withCors(response: Response, origin: string): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-credentials", "true");
  headers.set("cache-control", "no-store");
  appendVary(headers, "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function normalizedOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("自动化服务允许来源必须是纯 HTTPS origin");
  }
  return url.origin;
}

export function createAutomationService(
  options: AutomationServiceOptions,
): HttpHandler {
  const allowedOrigins = new Set(options.allowedOrigins.map(normalizedOrigin));
  if (allowedOrigins.size === 0) throw new Error("自动化服务至少需要一个记录视图来源");
  const routes = new Map<string, Route>([
    ["/v1/oauth/start", { method: "GET", handler: options.oauthStart }],
    ["/v1/oauth/callback", { method: "GET", handler: options.oauthCallback }],
    ["/v1/registry-write-token", {
      method: "POST",
      handler: options.registryAuthorization,
      cors: true,
    }],
    ["/v1/templates", { method: "POST", handler: options.templateRegistry, cors: true }],
    ["/v1/render", { method: "POST", handler: options.renderer }],
    ["/v1/background-jobs", { method: "POST", handler: options.backgroundJobs }],
    ["/v1/feishu/events", { method: "POST", handler: options.feishuEvents }],
  ]);

  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      if (request.method !== "GET") return jsonError(405, "METHOD_NOT_ALLOWED", "健康检查只接受 GET 请求");
      return Response.json({ status: "ok" }, {
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }

    const route = routes.get(url.pathname);
    if (!route) return jsonError(404, "NOT_FOUND", "请求地址不存在");
    if (request.method === "OPTIONS" && route.cors) {
      const origin = request.headers.get("origin")?.trim() ?? "";
      if (!allowedOrigins.has(origin)) return jsonError(403, "ORIGIN_DENIED", "请求来源不受信任");
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-credentials": "true",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "600",
          "cache-control": "no-store",
          vary: "Origin",
        },
      });
    }
    if (request.method !== route.method) {
      return jsonError(405, "METHOD_NOT_ALLOWED", `该地址只接受 ${route.method} 请求`);
    }
    if (!route.cors) return route.handler(request);
    const origin = request.headers.get("origin")?.trim() ?? "";
    if (!origin) return route.handler(request);
    if (!allowedOrigins.has(origin)) return jsonError(403, "ORIGIN_DENIED", "请求来源不受信任");
    return withCors(await route.handler(request), origin);
  };
}
