import type { AutomationOutputType } from "./automation-domain.ts";

export type RenderedArtifact = {
  artifactKey: string;
  fileName: string;
  contentType: string;
  pageCount: number;
  bytes: Uint8Array;
};

type ArtifactFactory = () => Promise<RenderedArtifact>;

const PDF_HEADER = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
const PNG_HEADER = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function hasHeader(bytes: Uint8Array, header: Uint8Array): boolean {
  if (bytes.byteLength < header.byteLength) return false;
  return header.every((byte, index) => bytes[index] === byte);
}

function assertFileName(fileName: string, extension: string): void {
  if (!fileName.trim().toLowerCase().endsWith(extension)) {
    throw new Error(`生成文件的名称必须以 ${extension} 结尾`);
  }
}

export function validateRenderedArtifact(
  expectedArtifactKey: string,
  outputType: AutomationOutputType,
  artifact: RenderedArtifact,
): RenderedArtifact {
  if (!expectedArtifactKey.trim() || artifact.artifactKey !== expectedArtifactKey) {
    throw new Error("渲染结果的产物键与当前任务不一致");
  }
  if (!(artifact.bytes instanceof Uint8Array) || artifact.bytes.byteLength === 0) {
    throw new Error("渲染结果没有有效文件内容");
  }
  if (!Number.isInteger(artifact.pageCount) || artifact.pageCount < 1) {
    throw new Error("渲染结果的页数无效");
  }

  if (outputType === "pdf") {
    if (artifact.contentType !== "application/pdf") {
      throw new Error("PDF 产物的内容类型不正确");
    }
    assertFileName(artifact.fileName, ".pdf");
    if (!hasHeader(artifact.bytes, PDF_HEADER)) {
      throw new Error("PDF 产物的文件头不正确");
    }
    return artifact;
  }

  if (outputType === "png") {
    if (artifact.contentType !== "image/png") {
      throw new Error("PNG 产物的内容类型不正确");
    }
    assertFileName(artifact.fileName, ".png");
    if (!hasHeader(artifact.bytes, PNG_HEADER)) {
      throw new Error("PNG 产物的文件头不正确");
    }
    if (artifact.pageCount !== 1) {
      throw new Error("PNG 自动化产物仅允许输出第一页");
    }
    return artifact;
  }

  throw new Error("自动化输出类型无效");
}

export type IdempotentArtifactCache = {
  getOrCreate(artifactKey: string, factory: ArtifactFactory): Promise<RenderedArtifact>;
  clear(artifactKey?: string): void;
};

export function createIdempotentArtifactCache(): IdempotentArtifactCache {
  const entries = new Map<string, Promise<RenderedArtifact>>();

  return {
    getOrCreate(artifactKey, factory) {
      const normalizedKey = artifactKey.trim();
      if (!normalizedKey) return Promise.reject(new Error("产物键不能为空"));

      const existing = entries.get(normalizedKey);
      if (existing) return existing;

      const pending = Promise.resolve()
        .then(factory)
        .then((artifact) => {
          if (artifact.artifactKey !== normalizedKey) {
            throw new Error("渲染结果的产物键与当前任务不一致");
          }
          return artifact;
        });
      entries.set(normalizedKey, pending);
      pending.catch(() => {
        if (entries.get(normalizedKey) === pending) entries.delete(normalizedKey);
      });
      return pending;
    },
    clear(artifactKey) {
      if (artifactKey === undefined) {
        entries.clear();
        return;
      }
      entries.delete(artifactKey.trim());
    },
  };
}
