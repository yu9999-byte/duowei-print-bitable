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
  assert.deepEqual(matches(/["']authorization["']\s*:/gi), []);
  assert.deepEqual(matches(/\bBearer\s+\$\{/g), []);
});
