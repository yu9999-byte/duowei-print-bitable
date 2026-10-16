import { isAbsolute } from "node:path";

export type AutomationServiceEnvironment = Readonly<Record<string, string | undefined>>;

export type AutomationServiceConfig = {
  port: number;
  publicBaseUrl: string;
  oauthRedirectUri: string;
  allowedOrigins: string[];
  feishuAppId: string;
  feishuAppSecret: string;
  registrySigningSecret: Uint8Array;
  registryReadSigningSecret: Uint8Array;
  rendererSigningSecret: Uint8Array;
  backgroundJobSigningSecret: Uint8Array;
  registryFilePath: string;
  backgroundJobFilePath: string;
  appTicketFilePath: string;
  eventVerificationToken: string;
  backgroundWorkerIntervalMs: number;
  rendererTimeoutMs: number;
};

const PLACEHOLDER = /(?:replace[_ -]?me|change[_ -]?me|todo)/i;

function required(environment: AutomationServiceEnvironment, key: string): string {
  const value = environment[key]?.trim() ?? "";
  if (!value || PLACEHOLDER.test(value)) throw new Error(`自动化服务配置 ${key} 缺失或仍是占位值`);
  return value;
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

function hexSecret(environment: AutomationServiceEnvironment, key: string): Uint8Array {
  const value = required(environment, key);
  if (!/^[0-9a-f]+$/i.test(value) || value.length < 64 || value.length % 2 !== 0) {
    throw new Error(`自动化服务配置 ${key} 必须是至少 32 字节的十六进制值`);
  }
  return Uint8Array.from({ length: value.length / 2 }, (_, index) => (
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  ));
}

function origins(environment: AutomationServiceEnvironment): string[] {
  const values = required(environment, "DUOWEI_RECORD_VIEW_ORIGINS")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const url = httpsUrl("记录视图 origin", value);
      if (url.pathname !== "/" || url.search) throw new Error("记录视图 origin 必须只包含来源");
      return url.origin;
    });
  if (!values.length) throw new Error("至少需要一个记录视图 origin");
  if (new Set(values).size !== values.length) throw new Error("记录视图 origin 不得重复");
  return values;
}

export function readAutomationServiceConfig(
  environment: AutomationServiceEnvironment,
): AutomationServiceConfig {
  const publicUrl = httpsUrl(
    "自动化服务公网地址",
    required(environment, "DUOWEI_PUBLIC_BASE_URL"),
  );
  publicUrl.pathname = publicUrl.pathname.replace(/\/+$/, "") || "/";
  if (publicUrl.pathname !== "/" || publicUrl.search) {
    throw new Error("自动化服务公网地址必须只包含 HTTPS origin");
  }
  const port = Number(environment.PORT?.trim() || "8080");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("自动化服务端口无效");
  }
  const rendererTimeoutMs = Number(environment.DUOWEI_RENDERER_TIMEOUT_MS?.trim() || "120000");
  if (!Number.isSafeInteger(rendererTimeoutMs) || rendererTimeoutMs < 30_000 || rendererTimeoutMs > 300_000) {
    throw new Error("自动化渲染超时必须介于 30000 至 300000 毫秒");
  }
  const registryFilePath = required(environment, "DUOWEI_REGISTRY_FILE_PATH");
  if (!isAbsolute(registryFilePath)) throw new Error("模板注册表持久化路径必须是绝对路径");
  const backgroundJobFilePath = required(environment, "DUOWEI_BACKGROUND_JOB_FILE_PATH");
  if (!isAbsolute(backgroundJobFilePath)) throw new Error("后台任务持久化路径必须是绝对路径");
  const appTicketFilePath = required(environment, "DUOWEI_APP_TICKET_FILE_PATH");
  if (!isAbsolute(appTicketFilePath)) throw new Error("app_ticket 持久化路径必须是绝对路径");
  const backgroundWorkerIntervalMs = Number(environment.DUOWEI_BACKGROUND_WORKER_INTERVAL_MS?.trim() || "1000");
  if (!Number.isSafeInteger(backgroundWorkerIntervalMs) || backgroundWorkerIntervalMs < 100 || backgroundWorkerIntervalMs > 60_000) {
    throw new Error("后台任务轮询间隔必须介于 100 至 60000 毫秒");
  }
  return {
    port,
    publicBaseUrl: publicUrl.toString(),
    oauthRedirectUri: new URL("/v1/oauth/callback", publicUrl).toString(),
    allowedOrigins: origins(environment),
    feishuAppId: required(environment, "DUOWEI_FEISHU_APP_ID"),
    feishuAppSecret: required(environment, "DUOWEI_FEISHU_APP_SECRET"),
    registrySigningSecret: hexSecret(environment, "DUOWEI_REGISTRY_SIGNING_SECRET_HEX"),
    registryReadSigningSecret: hexSecret(environment, "DUOWEI_REGISTRY_READ_SIGNING_SECRET_HEX"),
    rendererSigningSecret: hexSecret(environment, "DUOWEI_RENDERER_SIGNING_SECRET_HEX"),
    backgroundJobSigningSecret: hexSecret(environment, "DUOWEI_BACKGROUND_JOB_SIGNING_SECRET_HEX"),
    registryFilePath,
    backgroundJobFilePath,
    appTicketFilePath,
    eventVerificationToken: required(environment, "DUOWEI_EVENT_VERIFICATION_TOKEN"),
    backgroundWorkerIntervalMs,
    rendererTimeoutMs,
  };
}
