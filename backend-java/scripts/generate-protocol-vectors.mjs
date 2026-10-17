import fs from "node:fs";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
const root = new URL("../src/test/resources/", import.meta.url);
fs.mkdirSync(root, { recursive: true });
let seed = 324508639;
function next() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>> 0;
}
const bytes = Buffer.alloc(8);
const numbers = [];
for (let i = 0; i < 1e3; i++) {
  bytes.writeUInt32BE(next(), 0);
  bytes.writeUInt32BE(next(), 4);
  const number = bytes.readDoubleBE();
  if (Number.isFinite(number)) numbers.push({ bits: bytes.toString("hex"), expected: JSON.stringify(number) });
}
const objects = [
  { "2": "two", "10": "ten", "01": "leading", a: [null, true, false] },
  { "": "private", "😀": "emoji", "中文": 'line\nquote"slash\\' },
  { nested: { z: 1e23, a: -0, min: Number.MIN_VALUE }, array: [{ "2": 2, "10": 10 }] },
  { loneHigh: "\uD800", loneLow: "\uDFFF", validPair: "😀", "\uD800": "surrogate key" }
].map((input) => {
  const expected = canonical(input);
  return { input, expected, digest: crypto.createHash("sha256").update(expected).digest("base64url") };
});
for (const [name, vectors] of [["node-number-vectors.json", numbers], ["node-object-vectors.json", objects]]) {
  fs.writeFileSync(fileURLToPath(new URL(name, root)), `${JSON.stringify(vectors, null, 2)}
`);
}
