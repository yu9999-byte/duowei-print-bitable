import assert from "node:assert/strict";
import test from "node:test";
import type { Action } from "@lark-opdev/block-basekit-server-api";
import { registerFeishuAutomationBlock } from "../src/automation/feishu-automation-block.ts";

const secret = new TextEncoder().encode("automation-block-test-secret-that-is-long-enough");

test("SPEC-AUTO-01/02: automation block registers one action and only required outbound domains", () => {
  let domains: string[] = [];
  let action: Action | undefined;
  registerFeishuAutomationBlock({
    addDomainList(value) { domains = value; },
    addAction(value) { action = value; },
  }, {
    serviceAuthorization: "Bearer service-api-key",
    registryEndpoint: "https://registry.example/v1/templates",
    registryReadSigningSecret: secret,
    rendererEndpoint: "https://renderer.example/v1/render",
    rendererSigningSecret: secret,
    backgroundJobEndpoint: "https://service.example/v1/background-jobs",
    backgroundJobSigningSecret: secret,
  });
  assert.deepEqual(domains.sort(), ["open.feishu.cn", "registry.example", "renderer.example", "service.example"]);
  assert.equal(action?.actionText, "生成打印文件");
  assert.equal(action?.formItems?.filter((item) => item.itemId === "template").length, 1);
});

test("SPEC-AUTO-08: automation block refuses insecure or credential-bearing endpoint URLs", () => {
  const registrar = { addDomainList() {}, addAction() {} };
  for (const registryEndpoint of [
    "http://registry.example/v1/templates",
    "https://user:password@registry.example/v1/templates",
    "javascript:alert(1)",
  ]) {
    assert.throws(() => registerFeishuAutomationBlock(registrar, {
      registryEndpoint,
      registryReadSigningSecret: secret,
      rendererEndpoint: "https://renderer.example/v1/render",
      rendererSigningSecret: secret,
      backgroundJobEndpoint: "https://service.example/v1/background-jobs",
      backgroundJobSigningSecret: secret,
    }), /HTTPS|凭据|地址/);
  }
});
