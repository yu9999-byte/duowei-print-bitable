import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../src/App.vue", import.meta.url), "utf8");
const globalCss = await readFile(new URL("../src/style.css", import.meta.url), "utf8");

test("SPEC-UX-08: the workbench uses one shared visual token system", () => {
  for (const token of [
    "--dw-color-accent",
    "--dw-color-canvas",
    "--dw-color-surface",
    "--dw-color-text",
    "--dw-radius-panel",
    "--dw-shadow-paper",
  ]) {
    assert.ok(globalCss.includes(token), `missing visual token ${token}`);
  }
  assert.match(globalCss, /font-family:[^;]*(Segoe UI Variable|Microsoft YaHei UI)/);
});

test("SPEC-UX-08: output actions have an explicit primary/secondary hierarchy", () => {
  assert.match(appSource, /class="header-actions-secondary"/);
  assert.match(appSource, /class="header-actions-primary"/);
  assert.match(appSource, /class="button button-primary[^"]*"[^>]*@click="printOutput"/);
  assert.match(appSource, /class="button button-outline[^"]*"[^>]*@click="exportPdf"/);
});

test("SPEC-UX-08: template utilities stay quiet but remain keyboard discoverable", () => {
  assert.match(appSource, /\.template-directory-row:focus-within\s+\.template-item-actions/);
  assert.match(appSource, /\.template-directory-row:hover\s+\.template-item-actions/);
  assert.match(appSource, /\.template-item-active[^}]*var\(--dw-color-accent\)/s);
});

test("SPEC-UX-08: motion respects the operating-system reduced-motion preference", () => {
  assert.match(appSource, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(appSource, /focus-visible/);
});

test("SPEC-UX-08: the embedded designer follows the workbench light surface", () => {
  assert.match(appSource, /setTheme\?\.\("light"\)/);
});
