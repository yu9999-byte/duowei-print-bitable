import type { Action } from "@lark-opdev/block-basekit-server-api";
import { createFeishuAutomationActionDefinition } from "./feishu-action-definition.ts";
import { createFeishuAutomationAdapters } from "./feishu-action-adapters.ts";

export type AutomationBlockConfig = {
  serviceAuthorization: string;
  registryEndpoint: string;
  registryReadSigningSecret: Uint8Array;
  rendererEndpoint: string;
  rendererSigningSecret: Uint8Array;
  backgroundJobEndpoint: string;
  backgroundJobSigningSecret: Uint8Array;
  env?: string;
  now?: () => number;
};

export type AutomationBlockRegistrar = {
  addDomainList(domains: string[]): void;
  addAction(action: Action): void;
};

function serviceEndpoint(label: string, value: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error(`${label}地址无效`);
  }
  if (endpoint.protocol !== "https:") throw new Error(`${label}必须使用 HTTPS`);
  if (endpoint.username || endpoint.password) throw new Error(`${label}地址不得包含用户凭据`);
  if (endpoint.hash) throw new Error(`${label}地址不得包含片段`);
  return endpoint;
}

function signingSecret(label: string, value: Uint8Array): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength < 32) {
    throw new Error(`${label}签名密钥长度不足`);
  }
  return value;
}

export function registerFeishuAutomationBlock(
  registrar: AutomationBlockRegistrar,
  config: AutomationBlockConfig,
): void {
  const registryEndpoint = serviceEndpoint("模板注册表", config.registryEndpoint);
  const rendererEndpoint = serviceEndpoint("渲染服务", config.rendererEndpoint);
  const backgroundJobEndpoint = serviceEndpoint("后台任务服务", config.backgroundJobEndpoint);
  const serviceAuthorization = config.serviceAuthorization?.trim();
  if (!serviceAuthorization || !/^Bearer\s+\S+$/i.test(serviceAuthorization)) {
    throw new Error("自动化服务网关授权无效");
  }
  const registryReadSigningSecret = signingSecret(
    "模板注册表读取",
    config.registryReadSigningSecret,
  );
  const rendererSigningSecret = signingSecret("渲染服务", config.rendererSigningSecret);
  const backgroundJobSigningSecret = signingSecret("后台任务服务", config.backgroundJobSigningSecret);
  const adapters = createFeishuAutomationAdapters({
    serviceAuthorization,
    registryEndpoint: registryEndpoint.toString(),
    registryReadSigningSecret,
    rendererEndpoint: rendererEndpoint.toString(),
    rendererSigningSecret,
    backgroundJobEndpoint: backgroundJobEndpoint.toString(),
    backgroundJobSigningSecret,
    env: config.env,
    now: config.now,
  });
  registrar.addDomainList([...new Set([
    "open.feishu.cn",
    registryEndpoint.hostname,
    rendererEndpoint.hostname,
    backgroundJobEndpoint.hostname,
  ])]);
  registrar.addAction(createFeishuAutomationActionDefinition(adapters));
}
