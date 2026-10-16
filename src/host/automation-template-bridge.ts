import { RegistryConnectionRequiredError } from "../automation/registry-write-authorization.ts";
import type { RegistryWriteDraftRequest } from "../automation/template-registry-service.ts";

export type RegistryBridgeWindow = {
  readonly closed?: boolean;
  postMessage(message: unknown, targetOrigin: string): void;
};

export type RegistryBridgeMessage = {
  source: unknown;
  origin: string;
  data: unknown;
};

type PendingRequest = {
  resolve(): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

function safeMessage(value: unknown): string {
  const message = typeof value === "string" ? value : "自动化模板桥接失败";
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [已隐藏]")
    .replace(/((?:client[_-]?secret|access[_-]?token|authorization)\s*[=:]\s*)[^\s,;]+/gi, "$1[已隐藏]")
    .slice(0, 300)
    .trim() || "自动化模板桥接失败";
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function bridgeUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("自动化模板桥接地址不是有效 URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("自动化模板桥接地址必须是无凭据、无片段的 HTTPS URL");
  }
  return url;
}

export function createRegistryBridgeClient(options: {
  endpoint: string;
  timeoutMs?: number;
  requestId?: () => string;
}): {
  readonly endpoint: string;
  readonly origin: string;
  connect(target: RegistryBridgeWindow): void;
  disconnect(): void;
  probe(target: RegistryBridgeWindow): void;
  handleMessage(event: RegistryBridgeMessage): boolean;
  write(body: RegistryWriteDraftRequest): Promise<void>;
  dispose(): void;
} {
  const endpoint = bridgeUrl(options.endpoint);
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 10 * 60_000) {
    throw new Error("自动化模板桥接超时时间无效");
  }
  const createRequestId = options.requestId ?? (() => crypto.randomUUID());
  const pending = new Map<string, PendingRequest>();
  let target: RegistryBridgeWindow | null = null;
  let connected = false;

  const rejectPending = (message: string) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(message));
    }
    pending.clear();
  };

  return {
    endpoint: endpoint.toString(),
    origin: endpoint.origin,
    connect(nextTarget) {
      target = nextTarget;
      connected = true;
    },
    disconnect() {
      target = null;
      connected = false;
      rejectPending("自动化连接已断开，请重新连接");
    },
    probe(nextTarget) {
      target = nextTarget;
      connected = false;
      nextTarget.postMessage({ type: "duowei-print:bridge-probe", protocolVersion: 1 }, endpoint.origin);
    },
    handleMessage(event) {
      if (!target || event.source !== target || event.origin !== endpoint.origin) return false;
      const data = objectValue(event.data);
      if (!data || data.type !== "duowei-print:bridge-result") return false;
      const requestId = typeof data.requestId === "string" ? data.requestId : "";
      const request = pending.get(requestId);
      if (!request) return true;
      pending.delete(requestId);
      clearTimeout(request.timer);
      if (data.success === true) request.resolve();
      else {
        const code = typeof data.code === "string" && data.code ? `${data.code}：` : "";
        request.reject(new Error(`${code}${safeMessage(data.message)}`));
      }
      return true;
    },
    async write(body) {
      let isClosed = false;
      try { isClosed = target?.closed === true; } catch { isClosed = true; }
      if (!target || !connected || isClosed) {
        target = null;
        connected = false;
        throw new RegistryConnectionRequiredError(
          endpoint.toString(),
          "请先连接多维打印自动化服务，再同步当前模板",
        );
      }
      const requestId = createRequestId();
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(requestId) || pending.has(requestId)) {
        throw new Error("自动化模板桥接请求编号无效");
      }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error("自动化模板桥接超时，请保持连接窗口开启后重试"));
        }, timeoutMs);
        pending.set(requestId, { resolve, reject, timer });
        try {
          target!.postMessage({
            type: "duowei-print:bridge-sync",
            protocolVersion: 1,
            requestId,
            body,
          }, endpoint.origin);
        } catch (error) {
          clearTimeout(timer);
          pending.delete(requestId);
          reject(error instanceof Error ? error : new Error("自动化模板桥接请求发送失败"));
        }
      });
    },
    dispose() {
      target = null;
      connected = false;
      rejectPending("自动化模板桥接已关闭");
    },
  };
}
