import assert from "node:assert/strict";
import test from "node:test";
import { createRegistryBridgeClient } from "../src/host/automation-template-bridge.ts";

function draft() {
  return {
    scope: { baseToken: "base-a", tableId: "table-a" },
    template: {
      id: "template-a",
      name: "发货单",
      revision: "fnv1a32:12345678",
      snapshot: { canvasSize: { width: 600, height: 800 }, pages: [] },
      referencedFieldIds: [],
    },
  };
}

test("SPEC-AUTO-07: bridge accepts results only from the exact connected window and origin", async () => {
  const calls: unknown[] = [];
  const target = {
    closed: false,
    postMessage(message: unknown) { calls.push(message); },
  };
  const bridge = createRegistryBridgeClient({
    endpoint: "https://service.example/api/automation/bridge",
    requestId: () => "request-a",
  });
  bridge.connect(target);
  const pending = bridge.write(draft());
  assert.equal(calls.length, 1);
  assert.equal(bridge.handleMessage({
    source: {}, origin: bridge.origin,
    data: { type: "duowei-print:bridge-result", requestId: "request-a", success: true },
  }), false);
  assert.equal(bridge.handleMessage({
    source: target, origin: "https://evil.example",
    data: { type: "duowei-print:bridge-result", requestId: "request-a", success: true },
  }), false);
  assert.equal(bridge.handleMessage({
    source: target, origin: bridge.origin,
    data: { type: "duowei-print:bridge-result", requestId: "request-a", success: true },
  }), true);
  await pending;
  bridge.dispose();
});

test("SPEC-AUTO-07: bridge errors are bounded and redact credentials", async () => {
  const calls: unknown[] = [];
  const target = {
    closed: false,
    postMessage(message: unknown) { calls.push(message); },
  };
  const bridge = createRegistryBridgeClient({
    endpoint: "https://service.example/api/automation/bridge",
    requestId: () => "request-b",
  });
  bridge.connect(target);
  const pending = bridge.write(draft());
  bridge.handleMessage({
    source: target,
    origin: bridge.origin,
    data: {
      type: "duowei-print:bridge-result",
      requestId: "request-b",
      success: false,
      code: "REGISTRY_WRITE_FAILED",
      message: "authorization=secret Bearer abc.def",
    },
  });
  await assert.rejects(pending, /authorization=\[已隐藏\].*Bearer \[已隐藏\]/);
  bridge.dispose();
});
