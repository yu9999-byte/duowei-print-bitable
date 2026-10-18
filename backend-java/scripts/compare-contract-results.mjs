import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
function normalize(value, root = true) {
  if (Array.isArray(value)) return value.map((item) => normalize(item, false));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).filter((key) => !(root && key === "traceId")).sort().map((key) => [key, normalize(value[key], false)]));
  }
  return value;
}
function compareResults(original, java) {
  const failures = [];
  for (const [name, records] of [["original", original], ["java", java]]) {
    if (!Array.isArray(records) || records.length === 0) throw new Error(`${name}: nonempty results required`);
    const ids = records.map((record) => record.id);
    if (ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) throw new Error(`${name}: invalid or duplicate case ID`);
    for (const record of records) {
      if (!Number.isInteger(record.status) || record.status < 100 || record.status > 599 || !Object.hasOwn(record, "body")) throw new Error(`${name}: incomplete result`);
      const trace = record.body?.traceId;
      if (trace !== void 0 && (typeof trace !== "string" || !trace || record.traceHeader !== trace)) throw new Error(`${name}: invalid trace correlation`);
    }
  }
  const right = new Map(java.map((record) => [record.id, record]));
  for (const record of original) {
    const peer = right.get(record.id);
    if (!peer) {
      failures.push({ id: record.id, reason: "missing Java result" });
      continue;
    }
    right.delete(record.id);
    if (record.status !== peer.status || JSON.stringify(normalize(record.body)) !== JSON.stringify(normalize(peer.body))) failures.push({ id: record.id, reason: "status or body differs" });
  }
  for (const id of right.keys()) failures.push({ id, reason: "missing original result" });
  return { cases: original.length, passed: failures.length === 0, failures };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error("Usage: node compare-contract-results.mjs original.json java.json");
    const records = await Promise.all(process.argv.slice(2).map(async (file) => JSON.parse(await readFile(file, "utf8"))));
    const result = compareResults(...records);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.passed ? 0 : 1;
  } catch {
    console.error("Invalid input. Use two nonempty JSON result arrays; each record needs id, status, body and matching traceHeader when body.traceId exists.");
    process.exitCode = 2;
  }
}
export {
  compareResults
};
