import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import {
  base64UrlDecode,
  base64UrlEncode,
  constantTimeEqual,
  hmacSha256,
  portableNonce,
  sha256Bytes,
  sha256Hex,
  utf8Bytes,
  utf8String,
} from "../src/automation/portable-crypto.ts";

const samples = [
  "",
  "abc",
  "多维打印",
  "emoji: 🖨️ / 𝄞 / \u0000",
  "x".repeat(1_024),
];

test("SPEC-AUTO-09: portable SHA-256 and HMAC match Node without runtime globals", () => {
  const secret = utf8Bytes("portable-automation-signing-secret-that-is-long-enough");
  for (const sample of samples) {
    const expectedDigest = createHash("sha256").update(sample, "utf8").digest();
    assert.deepEqual([...sha256Bytes(utf8Bytes(sample))], [...expectedDigest]);
    assert.equal(sha256Hex(sample), expectedDigest.toString("hex"));

    const expectedHmac = createHmac("sha256", secret).update(sample, "utf8").digest();
    assert.deepEqual([...hmacSha256(secret, sample)], [...expectedHmac]);
  }
});

test("SPEC-AUTO-09: portable UTF-8 and base64url codecs round-trip automation payloads", () => {
  for (const sample of samples) {
    const bytes = utf8Bytes(sample);
    assert.equal(utf8String(bytes), sample);
    assert.deepEqual(base64UrlDecode(base64UrlEncode(bytes)), bytes);
  }
  assert.equal(base64UrlEncode(Uint8Array.from([0xfb, 0xff, 0xef])), "-__v");
});

test("SPEC-AUTO-09: portable nonce stays unique and comparison is length-safe", () => {
  const nonces = new Set(Array.from({ length: 128 }, () => portableNonce()));
  assert.equal(nonces.size, 128);
  for (const nonce of nonces) assert.match(nonce, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(constantTimeEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2)), true);
  assert.equal(constantTimeEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 3)), false);
  assert.equal(constantTimeEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2, 3)), false);
});
