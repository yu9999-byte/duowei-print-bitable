import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

function productionSourceFiles(directory = "src"): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionSourceFiles(path);
    return /\.(?:ts|vue)$/.test(entry.name) ? [path] : [];
  });
}

function matches(pattern: RegExp): string[] {
  return productionSourceFiles().flatMap((path) => {
    const source = readFileSync(path, "utf8");
    return source.split(/\r?\n/).flatMap((line, index) => {
      pattern.lastIndex = 0;
      return pattern.test(line) ? [`${relative(".", path)}:${index + 1}`] : [];
    });
  });
}

test("SPEC-SEC-01: production code does not write business data to console or browser storage", () => {
  assert.deepEqual(matches(/\bconsole\.(?:debug|error|info|log|trace|warn)\s*\(/g), []);
  assert.deepEqual(matches(/\b(?:localStorage|sessionStorage)\b/g), []);
});

test("SPEC-SEC-01: production code does not construct direct Authorization headers", () => {
  const authorizationHeaders = matches(/["']authorization["']\s*:/gi);
  const bearerTemplates = matches(/\bBearer\s+\$\{/g);
  const allowedServerBoundaries = [
    "src\\automation\\feishu-action-adapters.ts",
    "src\\automation\\feishu-background-ports.ts",
    "src\\automation\\feishu-oauth-session.ts",
  ];
  assert.equal(authorizationHeaders.length, 1);
  assert.equal(bearerTemplates.length, 6);
  assert.deepEqual([...new Set(authorizationHeaders.map((item) => item.replace(/:\d+$/, "")))], [allowedServerBoundaries[0]]);
  assert.deepEqual([...new Set(bearerTemplates.map((item) => item.replace(/:\d+$/, "")))], allowedServerBoundaries);
  const adapter = readFileSync(allowedServerBoundaries[0], "utf8");
  assert.match(adapter, /https:\/\/open\.feishu\.cn\/open-apis\/base\/v3\/bases/);
  assert.doesNotMatch(adapter, /rendererEndpoint[\s\S]{0,500}tenantAccessToken/);
  const backgroundPorts = readFileSync(allowedServerBoundaries[1], "utf8");
  assert.match(backgroundPorts, /https:\/\/open\.feishu\.cn\/open-apis\/bitable\/v1\/apps/);
  assert.match(backgroundPorts, /https:\/\/open\.feishu\.cn\/open-apis\/drive\/v1\/medias\/upload_all/);
  const oauth = readFileSync(allowedServerBoundaries[2], "utf8");
  assert.match(oauth, /https:\/\/accounts\.feishu\.cn\/oauth\/v3\/token/);
  assert.match(oauth, /https:\/\/open\.feishu\.cn\/open-apis\/authen\/v1\/user_info/);
  assert.match(oauth, /https:\/\/open\.feishu\.cn[\s\S]*?drive\/v1\/permissions/);
});
