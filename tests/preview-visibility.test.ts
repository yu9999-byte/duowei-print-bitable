import assert from "node:assert/strict";
import test from "node:test";
import { renderWhenVisible } from "../src/engine/preview-visibility.ts";

class VisibilityDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";

  show() {
    this.visibilityState = "visible";
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

test("SPEC-UX-01: background preview waits for a visible page before invoking the renderer", async () => {
  const page = new VisibilityDocument();
  page.visibilityState = "hidden";
  let calls = 0;
  const pending = renderWhenVisible(() => { calls += 1; return Promise.resolve("html"); }, page);
  await Promise.resolve();
  assert.equal(calls, 0);
  page.show();
  assert.equal(await pending, "html");
  assert.equal(calls, 1);
});

test("SPEC-UX-01: renderer timeout caused by tab hiding retries once after visibility returns", async () => {
  const page = new VisibilityDocument();
  let calls = 0;
  const pending = renderWhenVisible(() => {
    calls += 1;
    if (calls === 1) {
      page.visibilityState = "hidden";
      return Promise.reject(new Error("Print renderer timeout: print-renderer-rendered"));
    }
    return Promise.resolve("html");
  }, page);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  page.show();
  assert.equal(await pending, "html");
  assert.equal(calls, 2);
});

test("SPEC-UX-01: visible renderer errors propagate without a retry", async () => {
  const page = new VisibilityDocument();
  let calls = 0;
  await assert.rejects(renderWhenVisible(() => {
    calls += 1;
    return Promise.reject(new Error("broken template"));
  }, page), /broken template/);
  assert.equal(calls, 1);
});
