import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readAutomationBlockConfig } from "../src/automation/automation-block-config.ts";

const registrySecret = "11".repeat(32);
const rendererSecret = "22".repeat(32);
const backgroundSecret = "33".repeat(32);

test("SPEC-AUTO-01/08: deployment environment becomes one strict automation block config", () => {
  const config = readAutomationBlockConfig({
    DUOWEI_SERVICE_AUTHORIZATION: "Bearer service-api-key",
    DUOWEI_REGISTRY_ENDPOINT: "https://service.example/openapi/duowei-print/registry-read",
    DUOWEI_REGISTRY_READ_SIGNING_SECRET_HEX: registrySecret,
    DUOWEI_RENDERER_ENDPOINT: "https://service.example/openapi/duowei-print/render",
    DUOWEI_RENDERER_SIGNING_SECRET_HEX: rendererSecret,
    DUOWEI_BACKGROUND_JOB_ENDPOINT: "https://service.example/openapi/duowei-print/background-jobs",
    DUOWEI_BACKGROUND_JOB_SIGNING_SECRET_HEX: backgroundSecret,
    DUOWEI_PLATFORM_ENV: "feishu",
  });

  assert.equal(config.registryEndpoint, "https://service.example/openapi/duowei-print/registry-read");
  assert.equal(config.serviceAuthorization, "Bearer service-api-key");
  assert.deepEqual([...config.registryReadSigningSecret], new Array(32).fill(0x11));
  assert.equal(config.rendererEndpoint, "https://service.example/openapi/duowei-print/render");
  assert.deepEqual([...config.rendererSigningSecret], new Array(32).fill(0x22));
  assert.equal(config.backgroundJobEndpoint, "https://service.example/openapi/duowei-print/background-jobs");
  assert.deepEqual([...config.backgroundJobSigningSecret], new Array(32).fill(0x33));
  assert.equal(config.env, "feishu");
});

test("SPEC-AUTO-08: missing, placeholder, weak, and malformed deployment values fail closed", () => {
  const base = {
    DUOWEI_SERVICE_AUTHORIZATION: "Bearer service-api-key",
    DUOWEI_REGISTRY_ENDPOINT: "https://service.example/openapi/duowei-print/registry-read",
    DUOWEI_REGISTRY_READ_SIGNING_SECRET_HEX: registrySecret,
    DUOWEI_RENDERER_ENDPOINT: "https://service.example/openapi/duowei-print/render",
    DUOWEI_RENDERER_SIGNING_SECRET_HEX: rendererSecret,
    DUOWEI_BACKGROUND_JOB_ENDPOINT: "https://service.example/openapi/duowei-print/background-jobs",
    DUOWEI_BACKGROUND_JOB_SIGNING_SECRET_HEX: backgroundSecret,
  };

  for (const override of [
    { DUOWEI_SERVICE_AUTHORIZATION: "" },
    { DUOWEI_REGISTRY_ENDPOINT: "" },
    { DUOWEI_REGISTRY_ENDPOINT: "REPLACE_ME" },
    { DUOWEI_REGISTRY_ENDPOINT: "https://service.example/openapi/duowei-print/templates" },
    { DUOWEI_REGISTRY_READ_SIGNING_SECRET_HEX: "ab" },
    { DUOWEI_RENDERER_ENDPOINT: "https://service.example/openapi/duowei-print/registry-read" },
    { DUOWEI_RENDERER_SIGNING_SECRET_HEX: "zz".repeat(32) },
    { DUOWEI_BACKGROUND_JOB_ENDPOINT: "" },
    { DUOWEI_BACKGROUND_JOB_ENDPOINT: "https://service.example/openapi/duowei-print/render" },
    { DUOWEI_BACKGROUND_JOB_SIGNING_SECRET_HEX: "ab" },
    { DUOWEI_PLATFORM_ENV: "unknown" },
  ]) {
    assert.throws(() => readAutomationBlockConfig({ ...base, ...override }), /配置|密钥|环境/);
  }
});

test("SPEC-AUTO-01: independent server block entry registers and exports Basekit", async () => {
  const source = await readFile(new URL("../automation-block/src/register.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /runtime-compat|installAutomationRuntimeCompatibility/);
  assert.match(source, /registerFeishuAutomationBlock\(basekit,/);
  assert.match(source, /export default basekit/);
  assert.doesNotMatch(source, /[0-9a-f]{64}/i);
});

test("SPEC-AUTO-09: the FaaS entry does not patch globals or load Node crypto shims", async () => {
  const source = await readFile(new URL("../automation-block/src/register.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /globalThis|Object\.defineProperty|from ["'](?:node:)?(?:crypto|util)["']/);
});
