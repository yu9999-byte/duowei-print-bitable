import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
const checks = [];
function check(name, ready, detail) {
  checks.push({ name, ready, detail });
}
const javaHome = process.env.JAVA_HOME;
const java = javaHome ? `${javaHome}/bin/java${process.platform === "win32" ? ".exe" : ""}` : "java";
const version = spawnSync(java, ["-version"], { encoding: "utf8" });
check("JDK 8", version.status === 0 && /version "1\.8\./.test(version.stderr + version.stdout), "要求实际运行JDK8");
for (const name of [
  "DUOWEI_TEST_POSTGRES_URL",
  "DUOWEI_TEST_POSTGRES_USERNAME",
  "DUOWEI_TEST_POSTGRES_PASSWORD"
]) {
  check(name, Boolean(process.env[name]), "仅检查是否设置，不输出值");
}
check("真实浏览器测试开关", process.env.DUOWEI_TEST_REAL_BROWSER === "true", "DUOWEI_TEST_REAL_BROWSER=true");
check("Chrome可执行文件", Boolean(process.env.DUOWEI_CHROMIUM_EXECUTABLE_PATH) && existsSync(process.env.DUOWEI_CHROMIUM_EXECUTABLE_PATH), "DUOWEI_CHROMIUM_EXECUTABLE_PATH指向现有文件");
for (const item of checks) {
  console.log(`${item.ready ? "READY" : "MISSING"} ${item.name}: ${item.detail}`);
}
console.log("仅本机准备检查；未连接数据库、未调用飞书、不证明业务验收通过。");
process.exitCode = checks.every((item) => item.ready) ? 0 : 2;
