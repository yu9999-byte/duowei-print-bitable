import "vue-print-designer";
import "vue-print-designer/style.css";
import { renderAutomationArtifactInBrowser } from "../../src/automation/renderer-browser.ts";
import { validateRenderedArtifact } from "../../src/automation/automation-artifact.ts";
import type { AutomationRenderRequest } from "../../src/automation/automation-domain.ts";
import type { DesignerElement } from "../../src/engine/designer-adapter.ts";
import { fieldDataSourceId } from "../../src/core/data-sources.ts";

const result = document.querySelector<HTMLOutputElement>("#result")!;
const designer = document.querySelector<DesignerElement>("print-designer")!;
const orderToken = `@${fieldDataSourceId("order")}`;

const snapshot = {
  canvasSize: { width: 600, height: 400 },
  unit: "px",
  showGrid: false,
  allowDragOutsideCanvas: false,
  ext: {
    fieldBindings: { order: "订单编号" },
    availableVariables: [{ id: fieldDataSourceId("order"), label: "订单编号" }],
  },
  pages: [0, 1].map((index) => ({
    id: `page-${index + 1}`,
    elements: [{
      id: `order-${index + 1}`,
      type: "text",
      x: 30,
      y: 30,
      width: 520,
      height: 60,
      content: `第 ${index + 1} 页：${orderToken}`,
      variable: orderToken,
      printable: true,
      style: {
        fontSize: 24,
        color: "#111827",
        backgroundColor: "transparent",
        borderColor: "transparent",
      },
    }],
  })),
};

function request(type: "pdf" | "png"): AutomationRenderRequest {
  return {
    artifactKey: `duowei:v1:browser-${type}`,
    template: { id: "template-browser", revision: "revision-1", snapshot },
    values: { order: "DW-AUTO-001" },
    output: { type, pageLimit: type === "png" ? 1 : null },
  };
}

async function run() {
  await customElements.whenDefined("print-designer");
  if (!designer.isReady) {
    await new Promise<void>((resolve) => designer.addEventListener("ready", () => resolve(), { once: true }));
  }
  const pdf = validateRenderedArtifact(
    request("pdf").artifactKey,
    "pdf",
    await renderAutomationArtifactInBrowser(designer, request("pdf")),
  );
  const png = validateRenderedArtifact(
    request("png").artifactKey,
    "png",
    await renderAutomationArtifactInBrowser(designer, request("png")),
  );
  return {
    pdf: { pages: pdf.pageCount, bytes: pdf.bytes.byteLength, signature: new TextDecoder().decode(pdf.bytes.slice(0, 5)) },
    png: { pages: png.pageCount, bytes: png.bytes.byteLength, signature: Array.from(png.bytes.slice(0, 8)) },
  };
}

run().then(
  (value) => { result.textContent = JSON.stringify({ passed: true, ...value }); },
  (cause) => { result.textContent = JSON.stringify({
    passed: false,
    error: cause instanceof Error ? cause.message : String(cause),
  }); },
);
