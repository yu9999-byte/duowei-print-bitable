import "vue-print-designer";
import "vue-print-designer/style.css";
import {
  installAutomationRenderPageHost,
} from "../../src/automation/headless-renderer.ts";
import type { DesignerElement } from "../../src/engine/designer-adapter.ts";

async function install(): Promise<void> {
  await customElements.whenDefined("print-designer");
  const designer = document.querySelector<DesignerElement>("print-designer");
  if (!designer) throw new Error("自动化渲染页缺少打印设计器");
  if (!designer.isReady) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("自动化渲染器初始化超时")), 20_000);
      designer.addEventListener("ready", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }
  installAutomationRenderPageHost(designer);
}

void install();
