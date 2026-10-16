import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { build: esbuild } = require("esbuild");
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, "..");
const workspaceDirectory = resolve(projectDirectory, "..");
const stageRoot = join(projectDirectory, ".deploy-project");
const actionDirectory = join(stageRoot, "automation-action");
const stageSourceDirectory = join(actionDirectory, "src");
const cliDirectory = dirname(require.resolve("@lark-opdev/cli/package.json", {
  paths: [workspaceDirectory],
}));
const mode = process.argv[2] ?? "build";

if (!new Set(["build", "upload"]).has(mode)) {
  throw new Error("用法：node scripts/stage.mjs <build|upload>");
}

const requiredKeys = [
  "DUOWEI_SERVICE_AUTHORIZATION",
  "DUOWEI_REGISTRY_ENDPOINT",
  "DUOWEI_REGISTRY_READ_SIGNING_SECRET_HEX",
  "DUOWEI_RENDERER_ENDPOINT",
  "DUOWEI_RENDERER_SIGNING_SECRET_HEX",
  "DUOWEI_BACKGROUND_JOB_ENDPOINT",
  "DUOWEI_BACKGROUND_JOB_SIGNING_SECRET_HEX",
];
const deploymentEnvironment = Object.fromEntries(requiredKeys.map((key) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`缺少自动化部署配置 ${key}`);
  return [key, value];
}));
deploymentEnvironment.DUOWEI_PLATFORM_ENV = "feishu";

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: false });
  if (result.status !== 0) throw new Error(`${command} 执行失败`);
}

async function ensureOpdevRuntime() {
  try {
    require.resolve("@bdeefe/feishu-devtools-core/libs/config/env");
    return;
  } catch {
    // @lark-opdev/cli carries private runtime modules in temp_modules; npm's
    // ignore-scripts mode leaves them unstaged, so copy only when required.
  }
  const recoveryScript = join(cliDirectory, "scripts", "recover-modules.js");
  const tempModules = join(cliDirectory, "temp_modules");
  run(process.execPath, [recoveryScript, tempModules, join(projectDirectory, "node_modules")], projectDirectory);
}

async function bundle() {
  await esbuild({
    entryPoints: [join(projectDirectory, "src", "register.ts")],
    outfile: join(stageSourceDirectory, "register.js"),
    platform: "node",
    target: "node18",
    format: "cjs",
    bundle: true,
    minify: true,
    sourcemap: false,
    external: ["@lark-opdev/block-basekit-server-api"],
    define: {
      "process.env": JSON.stringify(deploymentEnvironment),
    },
  });
}

async function stage() {
  await rm(stageRoot, { recursive: true, force: true });
  await mkdir(stageSourceDirectory, { recursive: true });
  const block = JSON.parse(await readFile(join(projectDirectory, "block.json"), "utf8"));
  await Promise.all([
    writeFile(join(stageRoot, "app.json"), JSON.stringify({
      appId: "cli_aa3a18dc8eb95bd1",
      appName: "多维打印",
    }, null, 2)),
    writeFile(join(actionDirectory, "block.json"), JSON.stringify({
      blockTypeID: block.blockTypeID,
    }, null, 2)),
    writeFile(join(actionDirectory, "package.json"), JSON.stringify({
      name: "duowei-print-automation-action-runtime",
      private: true,
      version: "0.1.0",
      dependencies: {
        "@lark-opdev/block-basekit-server-api": "1.0.6",
      },
    }, null, 2)),
    writeFile(join(actionDirectory, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        target: "ES2020",
        rootDir: "src",
        moduleResolution: "node",
        module: "commonjs",
        allowJs: true,
        checkJs: false,
        skipLibCheck: true,
      },
      include: ["src/**/*"],
    }, null, 2)),
  ]);
  await bundle();
  await ensureOpdevRuntime();
  const cliPath = require.resolve("@lark-opdev/block-basekit-cli/dist/index.js");
  run(process.execPath, [cliPath, "build"], actionDirectory);
}

try {
  await stage();
  if (mode === "upload") {
    const opdevCliPath = join(cliDirectory, "bin", "run");
    run(process.execPath, [
      opdevCliPath, "upload", join(actionDirectory, "output"),
      "-t", "block", "-v", "patch",
      "-d", "多维打印自动化：单记录生成 PDF 或 PNG",
    ], workspaceDirectory);
  }
} finally {
  await rm(stageRoot, { recursive: true, force: true });
}
