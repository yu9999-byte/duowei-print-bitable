import { build } from "../../miaoda-duowei-automation/node_modules/esbuild/lib/main.js";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../miaoda-duowei-automation/", import.meta.url));
const directory = resolve(process.argv[2]);
await mkdir(directory, { recursive: true });
const built = await build({ stdin: { contents: 'export { createPlaywrightHeadlessRuntime } from "./server/modules/automation/browser-runtime"; export { createHeadlessBrowserRenderer } from "./server/duowei-core/headless-renderer";', resolveDir: root }, bundle: true, packages: "external", target: "node18", tsconfigRaw: { compilerOptions: { experimentalDecorators: true } }, platform: "node", format: "cjs", write: false });
const module = { exports: {} };
const require2 = createRequire(resolve(root, "package.json"));
new Function("require", "module", "exports", built.outputFiles[0].text)(require2, module, module.exports);
const { chromium } = require2("playwright-core");
const browserBuilt = await build({ entryPoints: [resolve(root, "client/src/automation-renderer-entry.ts")], bundle: true, minify: true, platform: "browser", format: "iife", target: ["chrome110"], outdir: "out", write: false, loader: { ".css": "css" } });
const js = browserBuilt.outputFiles.find((f) => f.path.endsWith(".js")).text.replace(/<\/script/gi, "<\\/script");
const css = browserBuilt.outputFiles.find((f) => f.path.endsWith(".css"))?.text ?? "";
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><script>${js}<\/script></body></html>`;
await writeFile(resolve(directory, "original-renderer.html"), html);
const server = createServer((request, response) => {
  if (request.headers.authorization !== "Bearer local-parity-test") {
    response.writeHead(401).end();
    return;
  }
  response.writeHead(200, { "content-type": "text/html;charset=UTF-8" });
  response.end(html);
});
await new Promise((resolve2) => server.listen(0, "127.0.0.1", resolve2));
let browser;
let browserLaunchMs;
try {
  const runtime = module.exports.createPlaywrightHeadlessRuntime({ renderPageUrl: new URL(`http://127.0.0.1:${server.address().port}/renderer`), authorization: "Bearer local-parity-test", browser: async () => {
    const launchStarted = performance.now();
    browser = await chromium.launch({ executablePath: process.env.DUOWEI_CHROMIUM_EXECUTABLE_PATH, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    browserLaunchMs = performance.now() - launchStarted;
    return browser;
  }, closeBrowser: async (value) => {
    await value.close();
    browser = void 0;
  } });
  const renderer = module.exports.createHeadlessBrowserRenderer(runtime);
  const text = (id, content, x, y, width, height, size = 20) => ({ id, type: "text", content, x, y, width, height, fontSize: size, style: { zIndex: 1, fontSize: size, fontFamily: "Microsoft YaHei", color: "#000000" } });
  const elements = [text("heading", "发货单 / DELIVERY NOTE", 35, 25, 530, 60, 28), { ...text("order", "订单: @__duowei_field_order", 35, 90, 530, 40), variable: "@__duowei_field_order" }, text("address", "收货地址：上海市测试路 88 号\n备注：验收合成数据", 35, 145, 530, 80)];
  for (let i = 0; i < 6; i++) {
    elements.push(text("item" + i, `商品 ${i + 1} / Item-${i + 1}`, 35, 250 + i * 55, 340, 45));
    elements.push(text("quantity" + i, String(i + 1) + " 件", 430, 250 + i * 55, 110, 45));
  }
  elements.push(text("total", "合计：21 件 / TOTAL 21", 35, 640, 530, 45, 24));
  const snapshot = { canvasSize: { width: 600, height: 800 }, pages: [{ id: "page-one", elements }, { id: "page-two", elements: [text("appendix", "附件明细 / APPENDIX", 35, 30, 530, 60, 28), text("second", "第二页内容校验 PAGE TWO", 35, 120, 530, 60)] }] };
  const timings = [];
  const repetitions = Number(process.env.DUOWEI_RENDER_BENCHMARK_REPETITIONS ?? 1);
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20) throw new Error("Invalid repetitions");
  for (const type of ["pdf", "png"]) {
    const request = { artifactKey: "duowei:v1:parity-" + type, template: { id: "delivery-note", revision: "r1", snapshot }, values: { order: "SO-2026-001" }, output: { type, pageLimit: type === "pdf" ? null : 1 } };
    await writeFile(resolve(directory, `request-${type}.json`), JSON.stringify(request, null, 2));
    let artifact;
    for (let iteration = 0; iteration < repetitions; iteration++) {
      const started = performance.now();
      artifact = await renderer.render(request);
      timings.push({ type, iteration, elapsedMs: performance.now() - started, bytes: artifact.bytes.length, driverLaunchMs: browserLaunchMs });
    }
    await writeFile(resolve(directory, "original." + type), artifact.bytes);
    const { bytes, ...metadata } = artifact;
    await writeFile(resolve(directory, `original-${type}-metadata.json`), JSON.stringify(metadata, null, 2));
  }
  await writeFile(resolve(directory, "original-timings.json"), JSON.stringify(timings, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise((resolve2) => server.close(resolve2));
}
console.log(directory);
