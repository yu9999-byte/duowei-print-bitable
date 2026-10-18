import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
try {
  const inputs = process.argv.slice(2);
  if (!inputs.length) throw new Error("Evidence files required");
  const files = await Promise.all(inputs.map(async (name) => ({ name: basename(name), bytes: await readFile(resolve(name)) })));
  const runId = `${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  const directory = resolve(root, "target/acceptance", runId);
  await mkdir(directory, { recursive: true });
  const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  const tracked = spawnSync("git", ["diff", "HEAD", "--", "."], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (revision.status !== 0 || tracked.status !== 0) throw new Error("Cannot record Git state");
  const manifest = {
    runId,
    capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
    revision: revision.stdout.trim(),
    trackedDiffSha256: createHash("sha256").update(tracked.stdout).digest("hex"),
    scope: "Explicitly supplied files only; tracked diff hash does not cover untracked source. Not an acceptance verdict.",
    files: []
  };
  for (const [index, file] of files.entries()) {
    const stored = `${index + 1}-${file.name}`;
    await writeFile(resolve(directory, stored), file.bytes, { flag: "wx" });
    manifest.files.push({ file: stored, bytes: file.bytes.length, sha256: createHash("sha256").update(file.bytes).digest("hex") });
  }
  await writeFile(resolve(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  console.log(directory);
} catch {
  console.error("Archive failed. Supply readable, reviewed evidence files; check filesystem and Git. No acceptance verdict produced.");
  process.exitCode = 2;
}
