import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readAutomationServiceConfig } from "../automation-service/src/config.ts";

const secret = "ab".repeat(32);

function environment() {
  return {
    DUOWEI_PUBLIC_BASE_URL: "https://automation.duowei.example",
    DUOWEI_RECORD_VIEW_ORIGINS: "https://blk_a.feishupkg.com,https://blk_b.feishupkg.com",
    DUOWEI_FEISHU_APP_ID: "cli_aa3a18dc8eb95bd1",
    DUOWEI_FEISHU_APP_SECRET: "server-only-secret",
    DUOWEI_REGISTRY_SIGNING_SECRET_HEX: secret,
    DUOWEI_REGISTRY_READ_SIGNING_SECRET_HEX: secret,
    DUOWEI_RENDERER_SIGNING_SECRET_HEX: secret,
    DUOWEI_BACKGROUND_JOB_SIGNING_SECRET_HEX: secret,
    DUOWEI_REGISTRY_FILE_PATH: "C:/data/registry.json",
    DUOWEI_BACKGROUND_JOB_FILE_PATH: "C:/data/background-jobs.json",
    DUOWEI_APP_TICKET_FILE_PATH: "C:/data/app-ticket.json",
    DUOWEI_EVENT_VERIFICATION_TOKEN: "event-verification-token",
    DUOWEI_BACKGROUND_WORKER_INTERVAL_MS: "1000",
    PORT: "8080",
  };
}

test("SPEC-AUTO-08: production service config is fail-closed and derives locked endpoints", () => {
  const config = readAutomationServiceConfig(environment());
  assert.equal(config.port, 8080);
  assert.equal(config.publicBaseUrl, "https://automation.duowei.example/");
  assert.equal(config.oauthRedirectUri, "https://automation.duowei.example/v1/oauth/callback");
  assert.deepEqual(config.allowedOrigins, [
    "https://blk_a.feishupkg.com",
    "https://blk_b.feishupkg.com",
  ]);
  assert.equal(config.registrySigningSecret.byteLength, 32);
  assert.equal(config.registryReadSigningSecret.byteLength, 32);
  assert.equal(config.rendererSigningSecret.byteLength, 32);
  assert.equal(config.backgroundJobSigningSecret.byteLength, 32);
  assert.equal(config.rendererTimeoutMs, 120000);
  assert.equal(config.backgroundJobFilePath, "C:/data/background-jobs.json");
  assert.equal(config.appTicketFilePath, "C:/data/app-ticket.json");
  assert.equal(config.eventVerificationToken, "event-verification-token");
  assert.equal(config.backgroundWorkerIntervalMs, 1000);
});

test("SPEC-AUTO-08: service config rejects missing, weak, duplicate, and unsafe values", () => {
  const valid = environment();
  for (const [key, value, pattern] of [
    ["DUOWEI_PUBLIC_BASE_URL", "http://service.example", /HTTPS/],
    ["DUOWEI_RECORD_VIEW_ORIGINS", "https://blk_a.feishupkg.com/path", /origin/],
    ["DUOWEI_FEISHU_APP_SECRET", "", /缺失/],
    ["DUOWEI_REGISTRY_SIGNING_SECRET_HEX", "ab", /32 字节/],
    ["DUOWEI_REGISTRY_FILE_PATH", "relative/registry.json", /绝对路径/],
    ["DUOWEI_BACKGROUND_JOB_FILE_PATH", "relative/jobs.json", /绝对路径/],
    ["DUOWEI_APP_TICKET_FILE_PATH", "relative/ticket.json", /绝对路径/],
    ["DUOWEI_EVENT_VERIFICATION_TOKEN", "", /缺失/],
    ["DUOWEI_BACKGROUND_WORKER_INTERVAL_MS", "10", /轮询/],
    ["PORT", "70000", /端口/],
    ["DUOWEI_RENDERER_TIMEOUT_MS", "1000", /超时/],
  ] as const) {
    assert.throws(() => readAutomationServiceConfig({ ...valid, [key]: value }), pattern);
  }
  assert.throws(() => readAutomationServiceConfig({
    ...valid,
    DUOWEI_RECORD_VIEW_ORIGINS: "https://blk_a.feishupkg.com,https://blk_a.feishupkg.com",
  }), /重复/);
});

test("SPEC-AUTO-02/08: deployable runtime contains Chromium, healthcheck, and no embedded credentials", () => {
  const dockerfile = readFileSync("automation-service/Dockerfile", "utf8");
  const server = readFileSync("automation-service/src/server.ts", "utf8");
  assert.match(dockerfile, /playwright/i);
  assert.match(dockerfile, /HEALTHCHECK[\s\S]*healthz/i);
  assert.match(server, /createFeishuOAuthSessionService/);
  assert.match(server, /createTemplateRegistryHttpHandler/);
  assert.match(server, /createRendererHttpHandler/);
  assert.match(server, /createAutomationService/);
  assert.match(server, /createBackgroundJobHttpHandler/);
  assert.match(server, /createAppTicketEventHandler/);
  assert.match(server, /createBackgroundJobProcessor/);
  assert.match(server, /new URL\("\.\/renderer\/index\.html", import\.meta\.url\)/);
  assert.doesNotMatch(server, /cli_aa3a18dc8eb95bd1|server-only-secret|F225904757/);
});
