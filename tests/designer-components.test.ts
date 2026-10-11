import assert from "node:assert/strict";
import test from "node:test";
import { DESIGNER_COMPONENT_GROUPS, DESIGNER_COMPONENTS } from "../src/components/designer-components.ts";

test("SPEC-UX-13: the product exposes every stable standard component supported by the locked designer", () => {
  assert.deepEqual(DESIGNER_COMPONENTS.map((component) => component.type), [
    "text",
    "image",
    "pageNumber",
    "table",
    "barcode",
    "qrcode",
    "line",
    "rect",
    "circle",
  ]);
  assert.deepEqual(DESIGNER_COMPONENT_GROUPS.map((group) => group.label), ["基础", "数据与编码", "形状"]);
});

test("SPEC-UX-13: multi-label remains a template layout instead of a draggable ordinary component", () => {
  assert.equal(DESIGNER_COMPONENTS.some((component) => component.type === "multiLabel"), false);
});
