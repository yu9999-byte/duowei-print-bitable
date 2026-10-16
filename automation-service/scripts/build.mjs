import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import webpack from "webpack";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const rendererConfig = require(resolve(root, "webpack.config.cjs"));

await new Promise((resolvePromise, reject) => {
  webpack(rendererConfig, (error, stats) => {
    if (error) {
      reject(error);
      return;
    }
    if (!stats) {
      reject(new Error("renderer build did not return stats"));
      return;
    }
    const details = stats.toString({ colors: true, chunks: false, modules: false });
    if (details) process.stdout.write(`${details}\n`);
    if (stats.hasErrors()) reject(new Error("renderer build failed"));
    else resolvePromise();
  });
});

await build({
  entryPoints: [resolve(root, "src/server.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["playwright"],
  outfile: resolve(root, "dist/server.mjs"),
});
