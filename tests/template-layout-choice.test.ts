import assert from "node:assert/strict";
import test from "node:test";
import {
  BATCH_LAYOUT_OPTIONS,
  ensureBatchLayout,
  getBatchLayoutMode,
  mergeEditedBaseTemplate,
  mergeEditedBatchLayout,
  setBatchLayoutMode,
} from "../src/components/template-layout-choice.ts";
import { TEMPLATE_CREATION_OPTIONS } from "../src/components/template-creation-choice.ts";

test("CT-TPL-06: template creation choices are blank and automatic only", () => {
  assert.deepEqual(TEMPLATE_CREATION_OPTIONS.map((option) => option.kind), ["blank", "automatic"]);
  assert.deepEqual(TEMPLATE_CREATION_OPTIONS.map((option) => option.label), ["空白模板", "自动生成模板"]);
});

test("UT-BATCH-LAYOUT-01: legacy structures infer their batch layout without mutation", () => {
  const ordinary = { pages: [{ elements: [] }] };
  assert.equal(getBatchLayoutMode(ordinary), "default");
  assert.equal(getBatchLayoutMode({
    ext: { batchLayout: "continuous" },
    pages: [{ elements: [] }],
  }), "continuous");
  assert.equal(getBatchLayoutMode({
    pages: [{ elements: [{ type: "multiLabel" }] }],
  }), "labels");
  assert.deepEqual(ordinary, { pages: [{ elements: [] }] });
});

test("UT-BATCH-LAYOUT-02: changing layout updates the same template value and leaves the source untouched", () => {
  const source = { id: "canvas", pages: [{ elements: [] }], ext: { custom: true } };
  const updated = setBatchLayoutMode(source, "continuous") as any;
  assert.equal(getBatchLayoutMode(updated), "continuous");
  assert.equal(updated.id, "canvas");
  assert.equal(updated.ext.custom, true);
  assert.equal((source.ext as any).duoweiBatchLayout, undefined);
  assert.deepEqual(BATCH_LAYOUT_OPTIONS.map((option) => option.kind), ["default", "continuous", "labels"]);
});

test("UT-BATCH-LAYOUT-02: continuous is an effective view while the stored base canvas stays ordinary", () => {
  const source = { id: "base", pages: [{ elements: [{ id: "title", type: "text" }] }], ext: {} };
  const result = ensureBatchLayout(source, "continuous", () => ({ id: "unused" }), () => ({ id: "unused-base" })) as any;
  assert.equal(result.persistentTemplate.id, "base");
  assert.equal(result.persistentTemplate.ext.batchLayout, undefined);
  assert.equal(result.persistentTemplate.ext.duoweiBatchLayout.mode, "continuous");
  assert.equal(result.effectiveTemplate.ext.batchLayout, "continuous");
  assert.deepEqual(source, { id: "base", pages: [{ elements: [{ id: "title", type: "text" }] }], ext: {} });
});

test("UT-BATCH-LAYOUT-02: label layout is stored inside the same template instead of creating another directory item", () => {
  const base = { id: "base", pages: [{ elements: [{ id: "title", type: "text" }] }], ext: {} };
  const label = { id: "label", pages: [{ elements: [{ id: "grid", type: "multiLabel" }] }], ext: {} };
  const result = ensureBatchLayout(base, "labels", () => label, () => base) as any;
  assert.equal(result.persistentTemplate.id, "base");
  assert.equal(result.persistentTemplate.ext.duoweiBatchLayout.mode, "labels");
  assert.equal(result.persistentTemplate.ext.duoweiBatchLayout.labelTemplate.id, "label");
  assert.equal(result.effectiveTemplate.id, "label");

  const editedLabel = { ...result.effectiveTemplate, marker: "edited-label" };
  const savedLabel = mergeEditedBatchLayout(result.persistentTemplate, editedLabel, "labels") as any;
  assert.equal(savedLabel.id, "base");
  assert.equal(savedLabel.marker, undefined);
  assert.equal(savedLabel.ext.duoweiBatchLayout.labelTemplate.marker, "edited-label");

  const editedBase = { id: "base", marker: "edited-base", pages: [{ elements: [] }], ext: {} };
  const savedBase = mergeEditedBaseTemplate(savedLabel, editedBase) as any;
  assert.equal(savedBase.marker, "edited-base");
  assert.equal(savedBase.ext.duoweiBatchLayout.mode, "labels");
  assert.equal(savedBase.ext.duoweiBatchLayout.labelTemplate.marker, "edited-label");
});

test("UT-BATCH-LAYOUT-02: a historical label root is migrated to an ordinary base without losing its label canvas", () => {
  const legacyLabel = {
    id: "legacy-label",
    pages: [{ elements: [{ id: "grid", type: "multiLabel" }, { id: "label-text", type: "text" }] }],
    canvasSize: { width: 794, height: 1123 },
    ext: { custom: "legacy" },
  };
  const generatedBase = {
    id: "generated-base",
    pages: [{ elements: [{ id: "title", type: "text" }] }],
    canvasSize: { width: 794, height: 1123 },
    ext: { custom: "base" },
  };

  const asDefault = ensureBatchLayout(legacyLabel, "default", () => ({ id: "unused" }), () => generatedBase) as any;
  assert.equal(asDefault.persistentTemplate.id, "generated-base");
  assert.equal(asDefault.effectiveTemplate.id, "generated-base");
  assert.equal(asDefault.persistentTemplate.ext.duoweiBatchLayout.mode, "default");
  assert.equal(asDefault.persistentTemplate.ext.duoweiBatchLayout.labelTemplate.id, "legacy-label");
  assert.equal(getBatchLayoutMode(asDefault.effectiveTemplate), "default");

  const backToLabels = ensureBatchLayout(
    asDefault.persistentTemplate,
    "labels",
    () => ({ id: "unused" }),
    () => generatedBase,
  ) as any;
  assert.equal(backToLabels.effectiveTemplate.id, "legacy-label");
  assert.equal(getBatchLayoutMode(backToLabels.persistentTemplate), "labels");
});

test("UT-BATCH-LAYOUT-02: saving the ordinary editor preserves an unmigrated historical label canvas", () => {
  const legacyLabel = {
    id: "legacy-label",
    pages: [{ elements: [{ id: "grid", type: "multiLabel" }] }],
    canvasSize: { width: 794, height: 1123 },
    ext: {},
  };
  const editedBase = {
    id: "edited-base",
    pages: [{ elements: [{ id: "title", type: "text" }] }],
    canvasSize: { width: 794, height: 1123 },
    ext: {},
  };

  const saved = mergeEditedBaseTemplate(legacyLabel, editedBase) as any;
  assert.equal(saved.id, "edited-base");
  assert.equal(saved.ext.duoweiBatchLayout.mode, "labels");
  assert.equal(saved.ext.duoweiBatchLayout.labelTemplate.id, "legacy-label");
});
