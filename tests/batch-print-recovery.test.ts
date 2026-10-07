import assert from "node:assert/strict";
import test from "node:test";
import {
  printRenderedPages,
  renderPrintJobCandidate,
  type RenderedPrintJob,
  type DesignerElement,
} from "../src/engine/designer-adapter.ts";
import type { PrintJob } from "../src/core/print-job.ts";

test("IT-BATCH-RECOVERY-01: a failed batch candidate keeps the committed preview printable", async () => {
  const committed = printJob(["old"]);
  const candidate = printJob(["new-1", "new-2"]);
  const committedRendered: RenderedPrintJob = {
    recordIds: ["old"],
    pages: ["<div>old preview</div>"],
    pageCounts: [1],
    canvasWidth: 794,
    canvasHeight: 1123,
  };
  let activeJob = committed;
  let activeRendered: RenderedPrintJob | null = committedRendered;
  const variableWrites: string[] = [];
  const designer = {
    async setVariables(values: Record<string, unknown>) {
      variableWrites.push(String(values.客户));
    },
    async getPreviewHtml() {
      throw new Error("candidate render failed");
    },
  } as unknown as DesignerElement;

  const applyCandidate = async () => {
    const rendered = await renderPrintJobCandidate(designer, committed, candidate);
    activeJob = candidate;
    activeRendered = rendered;
  };
  await assert.rejects(applyCandidate, { message: "candidate render failed" });

  // The host commits only after the candidate has rendered successfully.
  assert.equal(activeJob, committed);
  assert.equal(activeRendered, committedRendered);
  assert.equal(variableWrites.at(-1), "old");

  const printCalls: string[] = [];
  const restorePrintDom = installPrintDomMock(printCalls);
  try {
    await printRenderedPages(activeRendered);
  } finally {
    restorePrintDom();
  }
  assert.equal(printCalls.filter((call) => call === "documentPrint").length, 1);
});

function printJob(recordIds: string[]): PrintJob {
  return {
    source: { baseId: "base", tableId: "table", recordIds },
    table: { name: "订单", fields: [{ id: "customer", name: "客户", type: "1" }] },
    documents: recordIds.map((recordId) => ({ recordId, values: { 客户: recordId } })),
    generatedAt: "2026-10-03T00:00:00.000Z",
  };
}

function installPrintDomMock(calls: string[]) {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const node = () => ({
    innerHTML: "",
    id: "",
    querySelectorAll() { return []; },
    remove() { calls.push("removePrintRoot"); },
  });
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement(tag: string) {
      assert.equal(tag, "div");
      calls.push("createPrintRoot");
      return node();
    },
    body: { appendChild() { calls.push("appendPrintRoot"); } },
  } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    print() { calls.push("documentPrint"); },
    addEventListener() {},
    removeEventListener() {},
  } });
  return () => {
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  };
}
