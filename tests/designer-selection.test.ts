import assert from "node:assert/strict";
import test from "node:test";
import {
  isExplicitLayerActionControl,
  restoreImplicitSelectionLayering,
  withoutImplicitSelectionLayering,
} from "../src/core/designer-selection.ts";

const baseline = JSON.stringify({
  pages: [{ elements: [
    { id: "title", type: "text", style: { zIndex: 1, color: "#000" } },
    { id: "body", type: "text", style: { zIndex: 2 } },
  ] }],
});

test("selection-only zIndex changes do not make the template dirty", () => {
  const selected = JSON.stringify({
    pages: [{ elements: [
      { id: "title", type: "text", style: { zIndex: 9, color: "#000" } },
      { id: "body", type: "text", style: { zIndex: 2 } },
    ] }],
  });
  assert.equal(withoutImplicitSelectionLayering(selected, baseline), baseline);
});

test("explicit layer actions preserve the changed zIndex", () => {
  const raised = JSON.stringify({
    pages: [{ elements: [
      { id: "title", type: "text", style: { zIndex: 9, color: "#000" } },
      { id: "body", type: "text", style: { zIndex: 2 } },
    ] }],
  });
  assert.equal(withoutImplicitSelectionLayering(raised, baseline, true), raised);
});

test("template normalization keeps non-layer edits and new elements", () => {
  const edited = {
    pages: [{ elements: [
      { id: "title", type: "text", style: { zIndex: 9, color: "#f00" } },
      { id: "new", type: "text", style: { zIndex: 7 } },
    ] }],
  };
  const restored = restoreImplicitSelectionLayering(edited, baseline) as typeof edited;
  assert.equal(restored.pages[0].elements[0].style.color, "#f00");
  assert.equal(restored.pages[0].elements[0].style.zIndex, 1);
  assert.equal(restored.pages[0].elements[1].id, "new");
});

test("a canvas ancestor mentioning toolbar actions is not an explicit layer command", () => {
  assert.equal(isExplicitLayerActionControl({
    tagName: "DIV",
    text: "画布 置于顶层 置于底层 上移一层 下移一层",
  }), false);
  assert.equal(isExplicitLayerActionControl({
    tagName: "BUTTON",
    ariaLabel: "置于顶层",
  }), true);
  assert.equal(isExplicitLayerActionControl({
    tagName: "DIV",
    role: "menuitem",
    text: "下移一层",
  }), true);
});
