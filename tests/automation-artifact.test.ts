import assert from "node:assert/strict";
import test from "node:test";
import {
  createIdempotentArtifactCache,
  validateRenderedArtifact,
  type RenderedArtifact,
} from "../src/automation/automation-artifact.ts";

const pdfBytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n%%EOF");
const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

function artifact(overrides: Partial<RenderedArtifact> = {}): RenderedArtifact {
  return {
    artifactKey: "duowei:v1:key",
    fileName: "多维打印.pdf",
    contentType: "application/pdf",
    pageCount: 2,
    bytes: pdfBytes,
    ...overrides,
  };
}

test("IT-AUTO-02: a complete multi-page PDF and first-page PNG are accepted", () => {
  assert.equal(
    validateRenderedArtifact("duowei:v1:key", "pdf", artifact()).pageCount,
    2,
  );
  assert.equal(
    validateRenderedArtifact("duowei:v1:key", "png", artifact({
      fileName: "多维打印.png",
      contentType: "image/png",
      pageCount: 1,
      bytes: pngBytes,
    })).pageCount,
    1,
  );
});

test("IT-AUTO-02: wrong keys, formats, headers, or PNG page counts are rejected", () => {
  assert.throws(
    () => validateRenderedArtifact("duowei:v1:other", "pdf", artifact()),
    /产物键/,
  );
  assert.throws(
    () => validateRenderedArtifact("duowei:v1:key", "pdf", artifact({ contentType: "image/png" })),
    /PDF/,
  );
  assert.throws(
    () => validateRenderedArtifact("duowei:v1:key", "pdf", artifact({ bytes: pngBytes })),
    /文件头/,
  );
  assert.throws(
    () => validateRenderedArtifact("duowei:v1:key", "png", artifact({
      fileName: "多维打印.png",
      contentType: "image/png",
      pageCount: 2,
      bytes: pngBytes,
    })),
    /第一页/,
  );
});

test("IT-AUTO-01: concurrent retries share one render and failed renders remain retryable", async () => {
  const cache = createIdempotentArtifactCache();
  let calls = 0;
  const render = async () => {
    calls += 1;
    await Promise.resolve();
    return artifact();
  };
  const [first, second] = await Promise.all([
    cache.getOrCreate("duowei:v1:key", render),
    cache.getOrCreate("duowei:v1:key", render),
  ]);
  assert.equal(calls, 1);
  assert.equal(first, second);

  let failedCalls = 0;
  await assert.rejects(cache.getOrCreate("duowei:v1:failed", async () => {
    failedCalls += 1;
    throw new Error("render failed");
  }));
  await cache.getOrCreate("duowei:v1:failed", async () => {
    failedCalls += 1;
    return artifact({ artifactKey: "duowei:v1:failed" });
  });
  assert.equal(failedCalls, 2);
});
