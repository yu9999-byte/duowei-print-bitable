import { readdir, readFile, writeFile } from "node:fs/promises";
import { transform } from "../../miaoda-duowei-automation/node_modules/esbuild/lib/main.js";
const directory = new URL("./", import.meta.url);
const write = process.argv.includes("--write");
let mismatches = 0;
for (const name of (await readdir(directory)).filter((name2) => name2.endsWith(".mjs")).sort()) {
  const file = new URL(name, directory);
  const source = await readFile(file, "utf8");
  const result = await transform(source, {
    loader: "js",
    format: "esm",
    target: "esnext",
    minify: false,
    charset: "utf8",
    legalComments: "inline"
  });
  if (source.replace(/\r\n/g, "\n") === result.code) continue;
  if (write) await writeFile(file, result.code);
  else {
    console.error(`Script formatting differs: ${name}`);
    mismatches++;
  }
}
if (mismatches) process.exitCode = 1;
else console.log(write ? "Script formatting applied." : "Script formatting verified.");
