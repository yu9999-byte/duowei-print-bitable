import type { SharedTemplateTransport } from "./shared-template-storage.ts";

export class SharedTemplateConnectionRequiredError extends Error {
  constructor() { super("请连接飞书账号以读取共享模板"); }
}

type BridgeWindow = { readonly closed?: boolean; postMessage(message: unknown, origin: string): void };
export function createSharedTemplateBridge(endpoint: string) {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.pathname.endsWith("/shared-templates")) {
    throw new Error("共享模板服务地址无效");
  }
  const bridgeUrl = new URL(url.toString());
  bridgeUrl.pathname = bridgeUrl.pathname.replace(/\/shared-templates$/, "/bridge");
  let target: BridgeWindow | null = null;
  let ready = false;
  let probe: ReturnType<typeof setInterval> | undefined;
  const pending = new Map<string, { body: unknown; sent: boolean; resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const disconnect = () => {
    if (probe) clearInterval(probe);
    probe = undefined; target = null; ready = false;
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new SharedTemplateConnectionRequiredError()); }
    pending.clear();
  };
  const flush = () => {
    if (!ready || !target) return;
    for (const [requestId, entry] of pending) {
      if (entry.sent) continue;
      entry.sent = true;
      target.postMessage({ type: "duowei-print:shared-request", protocolVersion: 1, requestId, body: entry.body }, url.origin);
    }
  };
  const transport: SharedTemplateTransport = async (body) => {
    if (!target || target.closed) { disconnect(); throw new SharedTemplateConnectionRequiredError(); }
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("共享模板连接超时，请重新连接后核对保存结果")); }, 180_000);
      pending.set(requestId, { body, sent: false, resolve, reject, timer });
      flush();
    });
  };
  return {
    url: bridgeUrl.toString(), transport,
    attach(window: BridgeWindow) {
      disconnect(); target = window;
      const sendProbe = () => {
        if (!target || target.closed) { disconnect(); return; }
        if (!ready) target.postMessage({ type: "duowei-print:bridge-probe", protocolVersion: 1 }, url.origin);
      };
      sendProbe(); probe = setInterval(sendProbe, 500);
    },
    handleMessage(event: { source: unknown; origin: string; data: unknown }) {
      if (!target || event.source !== target || event.origin !== url.origin || !event.data || typeof event.data !== "object") return false;
      const data = event.data as Record<string, unknown>;
      if (data.protocolVersion !== 1) return false;
      if (data.type === "duowei-print:oauth-connected") { ready = true; flush(); return true; }
      if (data.type !== "duowei-print:shared-result" || typeof data.requestId !== "string") return false;
      const entry = pending.get(data.requestId);
      if (!entry) return true;
      pending.delete(data.requestId); clearTimeout(entry.timer);
      if (data.success === true) entry.resolve(data.value);
      else entry.reject(new Error(data.status === 409 ? "模板集合已被其他窗口更新，请重新加载后再保存" : "共享模板请求失败，请重新连接后重试"));
      return true;
    },
    dispose: disconnect,
  };
}
