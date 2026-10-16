// Feishu's automation FaaS still loads the uploaded CommonJS bundle through a
// restricted Node resolver.  The resolver exposes the classic builtin module
// names, but does not consistently accept the newer `node:` URL scheme.  Use
// the classic names here so the entry module can be evaluated before an
// autocomplete/execute invocation starts.
import { randomUUID, webcrypto } from "crypto";
import { TextDecoder, TextEncoder } from "util";

type RuntimeGlobals = typeof globalThis & {
  Buffer?: typeof Buffer;
};

function installValue(target: object, key: PropertyKey, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: false,
    writable: true,
    value,
  });
}

/**
 * The Feishu automation FaaS is a Node sandbox, while the shared signing
 * implementation intentionally uses Web Platform globals so it can also run
 * in the record-view browser. Older FaaS runtimes do not consistently expose
 * those globals. Install only the missing pieces before any action code runs.
 */
export function installAutomationRuntimeCompatibility(
  target: RuntimeGlobals = globalThis as RuntimeGlobals,
): void {
  const currentCrypto = target.crypto;
  if (!currentCrypto?.subtle || typeof currentCrypto.randomUUID !== "function") {
    installValue(target, "crypto", {
      subtle: webcrypto.subtle,
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      randomUUID,
    } as unknown as Crypto);
  }
  if (typeof target.TextEncoder !== "function") installValue(target, "TextEncoder", TextEncoder);
  if (typeof target.TextDecoder !== "function") installValue(target, "TextDecoder", TextDecoder);
  if (typeof target.btoa !== "function") {
    installValue(target, "btoa", (value: string) => Buffer.from(value, "binary").toString("base64"));
  }
  if (typeof target.atob !== "function") {
    installValue(target, "atob", (value: string) => Buffer.from(value, "base64").toString("binary"));
  }
}
