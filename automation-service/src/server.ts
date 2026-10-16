import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { createAutomationService } from "../../src/automation/automation-service.ts";
import { createBackgroundJobProcessor } from "../../src/automation/background-job.ts";
import { createJsonFileBackgroundJobStore } from "../../src/automation/background-job-file-store.ts";
import { createBackgroundJobHttpHandler } from "../../src/automation/background-job-service.ts";
import {
  createAppTicketEventHandler,
  createJsonFileAppTicketStore,
} from "../../src/automation/feishu-app-ticket.ts";
import {
  createFeishuBackgroundPorts,
  createMarketplaceTokenProvider,
} from "../../src/automation/feishu-background-ports.ts";
import { createFeishuOAuthSessionService } from "../../src/automation/feishu-oauth-session.ts";
import { createHeadlessBrowserRenderer } from "../../src/automation/headless-renderer.ts";
import {
  createRegistryWriteAuthorizationHttpHandler,
} from "../../src/automation/registry-write-authorization.ts";
import { createRendererHttpHandler } from "../../src/automation/renderer-service.ts";
import { createJsonFileTemplateRegistryStore } from "../../src/automation/template-registry-file-store.ts";
import {
  createAuthenticatedTemplateRegistry,
  createTemplateRegistryHttpHandler,
} from "../../src/automation/template-registry-service.ts";
import { createPlaywrightBrowserRuntime } from "./browser-runtime.ts";
import { readAutomationServiceConfig } from "./config.ts";

const config = readAutomationServiceConfig(process.env);
const browser = createPlaywrightBrowserRuntime(fileURLToPath(
  new URL("./renderer/index.html", import.meta.url),
));
const renderer = createHeadlessBrowserRenderer(browser.runtime);
const registry = createAuthenticatedTemplateRegistry({
  signingSecret: config.registrySigningSecret,
  store: createJsonFileTemplateRegistryStore({ path: config.registryFilePath }),
});
const oauth = createFeishuOAuthSessionService({
  clientId: config.feishuAppId,
  clientSecret: config.feishuAppSecret,
  redirectUri: config.oauthRedirectUri,
  serviceBaseUrl: config.publicBaseUrl,
  allowedOrigins: config.allowedOrigins,
});
const backgroundJobStore = createJsonFileBackgroundJobStore({ path: config.backgroundJobFilePath });
const appTicketStore = createJsonFileAppTicketStore({ path: config.appTicketFilePath });
const tokenProvider = createMarketplaceTokenProvider({
  appId: config.feishuAppId,
  appSecret: config.feishuAppSecret,
  ticketStore: appTicketStore,
});
const feishuBackgroundPorts = createFeishuBackgroundPorts({ tokenProvider });
const backgroundJobProcessor = createBackgroundJobProcessor({
  store: backgroundJobStore,
  ports: {
    ...feishuBackgroundPorts,
    render: renderer.render,
  },
});
const handler = createAutomationService({
  allowedOrigins: config.allowedOrigins,
  oauthStart: oauth.handleStart,
  oauthCallback: oauth.handleCallback,
  registryAuthorization: createRegistryWriteAuthorizationHttpHandler({
    signingSecret: config.registrySigningSecret,
    verifyIdentity: oauth.verifyIdentity,
  }),
  templateRegistry: createTemplateRegistryHttpHandler({
    registry,
    readSigningSecret: config.registryReadSigningSecret,
  }),
  renderer: createRendererHttpHandler({
    signingSecret: config.rendererSigningSecret,
    render: renderer.render,
    timeoutMs: config.rendererTimeoutMs,
  }),
  backgroundJobs: createBackgroundJobHttpHandler({
    store: backgroundJobStore,
    signingSecret: config.backgroundJobSigningSecret,
  }),
  feishuEvents: createAppTicketEventHandler({
    appId: config.feishuAppId,
    verificationToken: config.eventVerificationToken,
    store: appTicketStore,
  }),
});

let workerOperation: Promise<void> | null = null;
function runBackgroundWorker(): Promise<void> {
  if (workerOperation) return workerOperation;
  workerOperation = (async () => {
    const jobs = await backgroundJobStore.listRecoverable();
    for (const job of jobs) await backgroundJobProcessor.process(job.jobId);
  })().catch(() => {
    // Individual jobs persist their safe failure state; the next trigger may retry them.
  }).finally(() => {
    workerOperation = null;
  });
  return workerOperation;
}

const workerTimer = setInterval(() => { void runBackgroundWorker(); }, config.backgroundWorkerIntervalMs);
workerTimer.unref();
void runBackgroundWorker();

async function requestBody(request: IncomingMessage): Promise<Uint8Array | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
    size += bytes.byteLength;
    if (size > 3 * 1024 * 1024) throw new Error("请求体超过服务入口上限");
    chunks.push(bytes);
  }
  if (!size) return undefined;
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function webRequest(request: IncomingMessage): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  const body = await requestBody(request);
  return new Request(new URL(request.url ?? "/", config.publicBaseUrl), {
    method: request.method ?? "GET",
    headers,
    ...(body ? { body: body as BodyInit } : {}),
  });
}

async function writeResponse(response: ServerResponse, webResponse: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  webResponse.headers.forEach((value, name) => { headers[name] = value; });
  const getSetCookie = (webResponse.headers as Headers & { getSetCookie?(): string[] }).getSetCookie;
  if (getSetCookie) {
    const cookies = getSetCookie.call(webResponse.headers);
    if (cookies.length) headers["set-cookie"] = cookies;
  }
  response.writeHead(webResponse.status, headers);
  if (!webResponse.body) {
    response.end();
    return;
  }
  response.end(Buffer.from(await webResponse.arrayBuffer()));
}

const server = createServer(async (request, response) => {
  try {
    await writeResponse(response, await handler(await webRequest(request)));
  } catch {
    await writeResponse(response, Response.json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "自动化服务暂时不可用",
    }, { status: 500, headers: { "cache-control": "no-store" } }));
  }
});

server.listen(config.port, "0.0.0.0");

let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  clearInterval(workerTimer);
  if (workerOperation) await workerOperation;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await browser.close();
}

process.on("SIGTERM", () => { void close(); });
process.on("SIGINT", () => { void close(); });
