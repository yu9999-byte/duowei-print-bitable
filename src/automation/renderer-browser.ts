import { fieldDataSourceId, prepareTemplateForOutput } from "../core/data-sources.ts";
import type { AutomationRenderRequest } from "./automation-domain.ts";
import type { RenderedArtifact } from "./automation-artifact.ts";

export type BrowserDesigner = {
  loadTemplateData(template: unknown): boolean;
  setVariables(values: Record<string, unknown>): Promise<void>;
  export(request: { type: "pdfBlob" | "imageBlob"; merged?: boolean }): Promise<void | Blob>;
};

function automationVariables(values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([fieldId, value]) => [
    fieldDataSourceId(fieldId),
    value,
  ]));
}

function pdfPageCount(bytes: Uint8Array): number {
  const text = new TextDecoder("latin1").decode(bytes);
  const count = (text.match(/\/Type\s*\/Page\b/g) ?? []).length;
  if (count < 1) throw new Error("PDF 产物不包含有效页面");
  return count;
}

function canvasSize(snapshot: unknown): { width: number; height: number } {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("自动化模板快照无效");
  }
  const size = (snapshot as Record<string, unknown>).canvasSize;
  if (!size || typeof size !== "object" || Array.isArray(size)) {
    throw new Error("自动化模板缺少纸张尺寸");
  }
  const { width, height } = size as Record<string, unknown>;
  if (typeof width !== "number" || typeof height !== "number"
      || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("自动化模板纸张尺寸无效");
  }
  return { width, height };
}

async function firstPagePng(blob: Blob, snapshot: unknown): Promise<Blob> {
  if (!blob.type.startsWith("image/")) {
    throw new Error(`浏览器渲染器没有返回图片文件（实际类型：${blob.type || "未声明"}）`);
  }
  const size = canvasSize(snapshot);
  const bitmap = await createImageBitmap(blob);
  try {
    const pageHeight = Math.min(bitmap.height, Math.max(1, Math.round(bitmap.width * size.height / size.width)));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = pageHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法创建 PNG 画布");
    context.drawImage(bitmap, 0, 0, bitmap.width, pageHeight, 0, 0, bitmap.width, pageHeight);
    const cropped = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!cropped || cropped.size === 0) throw new Error("浏览器无法生成第一页 PNG");
    return cropped;
  } finally {
    bitmap.close();
  }
}

function fileName(request: AutomationRenderRequest): string {
  const safeId = request.template.id.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 60) || "template";
  return `多维打印-${safeId}.${request.output.type}`;
}

export async function renderAutomationArtifactInBrowser(
  designer: BrowserDesigner,
  request: AutomationRenderRequest,
): Promise<RenderedArtifact> {
  if (request.output.type === "pdf" && request.output.pageLimit !== null) {
    throw new Error("PDF 自动化产物必须输出完整多页文件");
  }
  if (request.output.type === "png" && request.output.pageLimit !== 1) {
    throw new Error("PNG 自动化产物仅允许输出第一页");
  }

  const variables = automationVariables(request.values);
  const prepared = prepareTemplateForOutput(request.template.snapshot, variables);
  if (!designer.loadTemplateData(prepared.template)) throw new Error("浏览器无法加载自动化模板");
  await designer.setVariables(prepared.variables);

  if (request.output.type === "pdf") {
    const blob = await designer.export({ type: "pdfBlob" });
    if (!(blob instanceof Blob) || blob.type !== "application/pdf" || blob.size === 0) {
      throw new Error("浏览器没有生成有效 PDF 文件");
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return {
      artifactKey: request.artifactKey,
      fileName: fileName(request),
      contentType: "application/pdf",
      pageCount: pdfPageCount(bytes),
      bytes,
    };
  }

  const image = await designer.export({ type: "imageBlob", merged: true });
  if (!(image instanceof Blob) || image.size === 0) throw new Error("浏览器没有生成有效 PNG 文件");
  const cropped = await firstPagePng(image, request.template.snapshot);
  return {
    artifactKey: request.artifactKey,
    fileName: fileName(request),
    contentType: "image/png",
    pageCount: 1,
    bytes: new Uint8Array(await cropped.arrayBuffer()),
  };
}
