import assert from "node:assert/strict";
import test from "node:test";
import { createSharedTemplateBridge } from "../src/host/shared-template-bridge.ts";

test("bridge verifies sender and protocol, sends each request once, and rejects pending requests on dispose", async () => {
  const bridge = createSharedTemplateBridge("https://print.example/api/automation/shared-templates");
  assert.equal(bridge.url, "https://print.example/api/automation/bridge");
  const messages: any[] = [];
  const popup = { postMessage: (data: unknown) => messages.push(data) };
  try {
    await assert.rejects(bridge.transport({ operation: "read", scope: { baseId: "b", tableId: "t" } }), /连接飞书/);
    bridge.attach(popup);
    const request = bridge.transport({ operation: "read", scope: { baseId: "b", tableId: "t" } });
    const connected = { type: "duowei-print:oauth-connected", protocolVersion: 1 };
    assert.equal(bridge.handleMessage({ source: {}, origin: "https://print.example", data: connected }), false);
    assert.equal(bridge.handleMessage({ source: popup, origin: "https://evil.example", data: connected }), false);
    assert.equal(messages.length, 1);
    bridge.handleMessage({ source: popup, origin: "https://print.example", data: connected });
    bridge.handleMessage({ source: popup, origin: "https://print.example", data: connected });
    assert.equal(messages.length, 2);
    bridge.handleMessage({ source: popup, origin: "https://print.example", data: { type: "duowei-print:shared-result", protocolVersion: 1, requestId: messages[1].requestId, success: true, value: { value: null } } });
    assert.deepEqual(await request, { value: null });
    const pending = bridge.transport({ operation: "read", scope: { baseId: "b", tableId: "t" } });
    bridge.dispose();
    await assert.rejects(pending, /连接飞书/);
  } finally { bridge.dispose(); }
});
