import type { AutomationBlockConfig } from "./feishu-automation-block.ts";

export type AutomationBlockEnvironment = Readonly<Record<string, string | undefined>>;

const PLACEHOLDER = /(?:replace[_ -]?me|change[_ -]?me|todo)/i;

function requiredValue(environment: AutomationBlockEnvironment, key: string): string {
  const value = environment[key]?.trim() ?? "";
  if (!value || PLACEHOLDER.test(value)) throw new Error(`自动化部署配置 ${key} 缺失或仍是占位值`);
  return value;
}

function serviceRoute(
  environment: AutomationBlockEnvironment,
  key: string,
  expectedSuffix: string,
): string {
  const value = requiredValue(environment, key);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`自动化部署配置 ${key} 不是有效 URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(`自动化部署配置 ${key} 必须是无凭据、查询和片段的 HTTPS 地址`);
  }
  if (!url.pathname.endsWith(expectedSuffix)) {
    throw new Error(`自动化部署配置 ${key} 必须指向 ${expectedSuffix}`);
  }
  return url.toString();
}

function hexSecret(environment: AutomationBlockEnvironment, key: string): Uint8Array {
  const value = requiredValue(environment, key);
  if (!/^[0-9a-f]+$/i.test(value) || value.length < 64 || value.length % 2 !== 0) {
    throw new Error(`自动化部署密钥 ${key} 必须是至少 32 字节的十六进制值`);
  }
  return Uint8Array.from({ length: value.length / 2 }, (_, index) => (
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  ));
}

export function readAutomationBlockConfig(
  environment: AutomationBlockEnvironment,
): AutomationBlockConfig {
  const platform = environment.DUOWEI_PLATFORM_ENV?.trim() || "feishu";
  if (platform !== "feishu") throw new Error("自动化部署环境目前只允许 feishu");
  return {
    serviceAuthorization: requiredValue(environment, "DUOWEI_SERVICE_AUTHORIZATION"),
    registryEndpoint: serviceRoute(
      environment,
      "DUOWEI_REGISTRY_ENDPOINT",
      "/openapi/duowei-print/registry-read",
    ),
    registryReadSigningSecret: hexSecret(
      environment,
      "DUOWEI_REGISTRY_READ_SIGNING_SECRET_HEX",
    ),
    rendererEndpoint: serviceRoute(
      environment,
      "DUOWEI_RENDERER_ENDPOINT",
      "/openapi/duowei-print/render",
    ),
    rendererSigningSecret: hexSecret(
      environment,
      "DUOWEI_RENDERER_SIGNING_SECRET_HEX",
    ),
    backgroundJobEndpoint: serviceRoute(
      environment,
      "DUOWEI_BACKGROUND_JOB_ENDPOINT",
      "/openapi/duowei-print/background-jobs",
    ),
    backgroundJobSigningSecret: hexSecret(
      environment,
      "DUOWEI_BACKGROUND_JOB_SIGNING_SECRET_HEX",
    ),
    env: platform,
  };
}
