import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "../automation-block/node_modules/esbuild/lib/main.js";

const deploymentEnvironment = {
  DUOWEI_SERVICE_AUTHORIZATION: "Bearer bundle-test-service-key",
  DUOWEI_REGISTRY_ENDPOINT: "https://service.example/openapi/duowei-print/registry-read",
  DUOWEI_REGISTRY_READ_SIGNING_SECRET_HEX: "11".repeat(32),
  DUOWEI_RENDERER_ENDPOINT: "https://service.example/openapi/duowei-print/render",
  DUOWEI_RENDERER_SIGNING_SECRET_HEX: "22".repeat(32),
  DUOWEI_BACKGROUND_JOB_ENDPOINT: "https://service.example/openapi/duowei-print/background-jobs",
  DUOWEI_BACKGROUND_JOB_SIGNING_SECRET_HEX: "33".repeat(32),
  DUOWEI_PLATFORM_ENV: "feishu",
};

test("SPEC-AUTO-09: uploaded bundle loads and autocompletes without mutable Web globals or Node crypto shims", async () => {
  const built = await build({
    entryPoints: [fileURLToPath(new URL("../automation-block/src/register.ts", import.meta.url))],
    platform: "node",
    target: "node18",
    format: "cjs",
    bundle: true,
    write: false,
    external: ["@lark-opdev/block-basekit-server-api"],
    define: { "process.env": JSON.stringify(deploymentEnvironment) },
  });
  const source = new TextDecoder().decode(built.outputFiles[0]?.contents);
  assert.doesNotMatch(source, /require\(["'](?:node:)?(?:crypto|util)["']\)/);

  let registeredAction: { formItems?: Array<Record<string, unknown>> } | undefined;
  let requested = false;
  const basekit = {
    addDomainList() {},
    addAction(action: typeof registeredAction) { registeredAction = action; },
  };
  const sandbox = vm.createContext({
    module: { exports: {} },
    exports: {},
    require(id: string) {
      if (id !== "@lark-opdev/block-basekit-server-api") throw new Error(`unexpected module: ${id}`);
      return {
        basekit,
        Component: { SingleSelect: "SingleSelect", Radio: "Radio", Tips: "Tips" },
        NextStep: { SetRecord: "SetRecord" },
        ParamType: { String: "string" },
        StructureType: { Attachment: "attachment" },
        async uploadAttachments() { return []; },
      };
    },
    URL,
    crypto: undefined,
    TextEncoder: undefined,
    TextDecoder: undefined,
    btoa: undefined,
    atob: undefined,
  });
  vm.runInContext(source, sandbox);

  const templateItem = registeredAction?.formItems?.find((item) => item.itemId === "template") as {
    autocomplete?: (args: unknown, context: unknown, payload: unknown) => Promise<unknown>;
  } | undefined;
  assert.equal(typeof templateItem?.autocomplete, "function");
  const result = await templateItem!.autocomplete!({}, {
    tenantKey: "tenant-a",
    app: { token: "base-a", trigger: { tableID: "table-a" } },
    async fetch(_url: string, init: { headers?: Record<string, string> }) {
      requested = true;
      assert.match(init.headers?.["x-duowei-service-signature"] ?? "", /^duowei-registry-read-v1\./);
      return { ok: true, async json() { return { templates: [] }; } };
    },
  }, { keyword: "", lang: "zh-CN" });
  assert.equal(requested, true);
  assert.equal(JSON.stringify(result), JSON.stringify({ options: [], isPaginated: false, isLastPage: true }));
});
