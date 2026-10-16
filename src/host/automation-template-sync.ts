import { createRegistryWriteAuthorizationClient } from "../automation/registry-write-authorization.ts";
import { createTemplateRegistryHttpTransport } from "../automation/template-registry-service.ts";
import {
  createRecordViewTemplateSync,
  createRecordViewTemplateSyncWithWriter,
} from "../automation/template-sync.ts";
import { createRegistryBridgeClient } from "./automation-template-bridge.ts";

export type RecordViewTemplateSyncConfig = {
  authorizationEndpoint: string;
  registryEndpoint: string;
  bridgeEndpoint?: string;
};

export type RecordViewAutomationTemplateSync = ReturnType<typeof createRecordViewTemplateSync> & {
  bridge?: ReturnType<typeof createRegistryBridgeClient>;
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

declare const __DUOWEI_TEMPLATE_SYNC_CONFIG__: RecordViewTemplateSyncConfig;

function endpoint(label: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label}配置不是有效 URL`);
  }
  if (url.protocol !== "https:") throw new Error(`${label}必须使用 HTTPS`);
  if (url.username || url.password) throw new Error(`${label}不得包含用户凭据`);
  if (url.hash) throw new Error(`${label}不得包含片段`);
  return url.toString();
}

export function createRecordViewAutomationTemplateSync(
  config: RecordViewTemplateSyncConfig,
  fetcher: FetchLike = fetch,
): RecordViewAutomationTemplateSync | null {
  const bridgeValue = config.bridgeEndpoint?.trim() ?? "";
  if (bridgeValue) {
    const bridge = createRegistryBridgeClient({ endpoint: endpoint("模板同步桥接地址", bridgeValue) });
    return Object.assign(createRecordViewTemplateSyncWithWriter(bridge), { bridge });
  }
  const authorizationValue = config.authorizationEndpoint.trim();
  const registryValue = config.registryEndpoint.trim();
  if (!authorizationValue && !registryValue) return null;
  if (!authorizationValue || !registryValue) throw new Error("自动化模板同步配置不完整");

  const authorizationEndpoint = endpoint("模板同步授权地址", authorizationValue);
  const registryEndpoint = endpoint("模板注册表写入地址", registryValue);
  const timedFetch: FetchLike = (input, init = {}) => fetcher(input, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(10_000),
  });

  return createRecordViewTemplateSync({
    identity: createRegistryWriteAuthorizationClient({
      endpoint: authorizationEndpoint,
      fetch: timedFetch,
    }),
    registry: createTemplateRegistryHttpTransport({
      endpoint: registryEndpoint,
      fetch: timedFetch,
    }),
  });
}

const runtimeConfig = typeof __DUOWEI_TEMPLATE_SYNC_CONFIG__ === "undefined"
  ? { authorizationEndpoint: "", registryEndpoint: "", bridgeEndpoint: "" }
  : __DUOWEI_TEMPLATE_SYNC_CONFIG__;

export const automationTemplateSync = createRecordViewAutomationTemplateSync(runtimeConfig);
