import assert from "node:assert/strict";
import test from "node:test";
import {
  commitBatchPrintSession,
  createSinglePrintSession,
} from "../src/core/batch-print-session.ts";
import { getBatchWorkspaceActionState } from "../src/components/batch-workspace-action-state.ts";

function batchSession(recordIds: string[]) {
  const result = commitBatchPrintSession(createSinglePrintSession("host-record"), {
    recordIds,
    summaries: recordIds.map((recordId) => ({ recordId, label: `PO-${recordId}` })),
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.message);
  return result.session;
}

function workspaceState(overrides: Partial<Parameters<typeof getBatchWorkspaceActionState>[0]> = {}) {
  return getBatchWorkspaceActionState({
    busy: false,
    retryAvailable: true,
    workspaceMode: "preview",
    templateLoaded: true,
    hasRenderedPages: true,
    session: batchSession(["0001", "0002", "0003"]),
    ...overrides,
  });
}

test("CT-BATCH-07-WORKSPACE: timeout keeps the committed batch visible and output-enabled", () => {
  const state = workspaceState();

  assert.equal(state.retryVisible, true);
  assert.equal(state.outputDisabled, false);
  assert.equal(state.printLabel, "打印 3 条");
  assert.equal(state.exportPdfLabel, "导出 3 条 PDF");
  assert.deepEqual(state.summaries.map((item) => item.label), ["PO-0001", "PO-0002", "PO-0003"]);
});

test("CT-BATCH-07-WORKSPACE: retry hides duplicate retry and temporarily disables output without clearing the old batch", () => {
  const committed = batchSession(["0001", "0002", "0003"]);
  const state = workspaceState({ busy: true, session: committed });

  assert.equal(state.retryVisible, false);
  assert.equal(state.outputDisabled, true);
  assert.deepEqual(state.recordIds, ["0001", "0002", "0003"]);
  assert.deepEqual(state.summaries.map((item) => item.label), ["PO-0001", "PO-0002", "PO-0003"]);
});

test("CT-BATCH-07-WORKSPACE: a successful retry replaces count, labels and summaries together", () => {
  const oldState = workspaceState();
  const nextState = workspaceState({
    retryAvailable: false,
    session: batchSession(["0004", "0005"]),
  });

  assert.deepEqual(oldState.recordIds, ["0001", "0002", "0003"]);
  assert.equal(nextState.retryVisible, false);
  assert.equal(nextState.outputDisabled, false);
  assert.deepEqual(nextState.recordIds, ["0004", "0005"]);
  assert.deepEqual(nextState.summaries.map((item) => item.label), ["PO-0004", "PO-0005"]);
  assert.equal(nextState.printLabel, "打印 2 条");
  assert.equal(nextState.exportPdfLabel, "导出 2 条 PDF");
});
