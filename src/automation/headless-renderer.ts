import type { AutomationRenderRequest } from "./automation-domain.ts";
import type { RenderedArtifact } from "./automation-artifact.ts";
import {
  renderAutomationArtifactInBrowser,
  type BrowserDesigner,
} from "./renderer-browser.ts";

export type SerializedRenderedArtifact = Omit<RenderedArtifact, "bytes"> & {
  protocolVersion: 1;
  bytes: number[];
};

export type AutomationRenderPageApi = {
  render(request: AutomationRenderRequest): Promise<SerializedRenderedArtifact>;
};

export type AutomationRenderPageTarget = {
  __DUOWEI_AUTOMATION_RENDERER__?: AutomationRenderPageApi;
};

export type HeadlessRenderPage = {
  render(request: AutomationRenderRequest): Promise<SerializedRenderedArtifact>;
  close(): Promise<void>;
};

export type HeadlessBrowserRuntime = {
  openPage(): Promise<HeadlessRenderPage>;
};

export function installAutomationRenderPageHost(
  designer: BrowserDesigner,
  target: AutomationRenderPageTarget = globalThis as AutomationRenderPageTarget,
): () => void {
  const api: AutomationRenderPageApi = {
    async render(request) {
      const artifact = await renderAutomationArtifactInBrowser(designer, request);
      return {
        protocolVersion: 1,
        artifactKey: artifact.artifactKey,
        fileName: artifact.fileName,
        contentType: artifact.contentType,
        pageCount: artifact.pageCount,
        bytes: Array.from(artifact.bytes),
      };
    },
  };
  target.__DUOWEI_AUTOMATION_RENDERER__ = api;
  return () => {
    if (target.__DUOWEI_AUTOMATION_RENDERER__ === api) {
      delete target.__DUOWEI_AUTOMATION_RENDERER__;
    }
  };
}

function deserializeArtifact(value: SerializedRenderedArtifact): RenderedArtifact {
  if (!value || typeof value !== "object" || value.protocolVersion !== 1) {
    throw new Error("无头浏览器渲染页协议版本不兼容");
  }
  if (!Array.isArray(value.bytes) || value.bytes.length === 0
    || value.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new Error("无头浏览器渲染页返回了无效文件内容");
  }
  if (typeof value.artifactKey !== "string" || typeof value.fileName !== "string"
    || typeof value.contentType !== "string" || !Number.isInteger(value.pageCount)) {
    throw new Error("无头浏览器渲染页返回了无效元数据");
  }
  return {
    artifactKey: value.artifactKey,
    fileName: value.fileName,
    contentType: value.contentType,
    pageCount: value.pageCount,
    bytes: Uint8Array.from(value.bytes),
  };
}

export function createHeadlessBrowserRenderer(runtime: HeadlessBrowserRuntime): {
  render(request: AutomationRenderRequest, signal?: AbortSignal): Promise<RenderedArtifact>;
} {
  return {
    async render(request, signal) {
      if (signal?.aborted) throw new DOMException("渲染已取消", "AbortError");
      const page = await runtime.openPage();
      const abort = () => { void page.close(); };
      if (signal?.aborted) {
        await page.close();
        throw new DOMException("渲染已取消", "AbortError");
      }
      signal?.addEventListener("abort", abort, { once: true });
      try {
        return deserializeArtifact(await page.render(request));
      } finally {
        signal?.removeEventListener("abort", abort);
        await page.close();
      }
    },
  };
}
