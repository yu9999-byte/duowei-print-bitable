import assert from "node:assert/strict";
import test from "node:test";
import {
  createDataSourceTokenCodec,
  type PastedDataSourceBinding,
} from "../src/core/data-source-token-codec.ts";
import { fieldDataSourceId, SYSTEM_PRINT_DATE_ID } from "../src/core/data-sources.ts";

const orderToken = `@${fieldDataSourceId("order-no")}`;
const customerToken = `@${fieldDataSourceId("customer")}`;

function codec(names: { order?: string; customer?: string } = {}) {
  return createDataSourceTokenCodec([
    { id: fieldDataSourceId("order-no"), label: names.order ?? "订单编号" },
    { id: fieldDataSourceId("customer"), label: names.customer ?? "客户名称" },
    { id: SYSTEM_PRINT_DATE_ID, label: "打印日期" },
  ]);
}

test("UT-SRC-06: stable tokens become friendly labels and round-trip without losing static text", () => {
  const source = `订单：${orderToken} / 客户：${customerToken} / @普通文字`;
  const editing = codec().toEditingContent(source);

  assert.equal(editing.content, "订单：@订单编号 / 客户：@客户名称 / @普通文字");
  assert.deepEqual(editing.issues, []);
  assert.equal(codec().toPersistentContent(editing.content, {
    previousContent: source,
  }).content, source);
});

test("UT-SRC-06: field rename changes the label but keeps the stable binding", () => {
  const renamed = codec({ order: "销售单号" });
  assert.equal(renamed.toEditingContent(orderToken).content, "@销售单号");
  assert.equal(renamed.toPersistentContent("@销售单号", {
    previousContent: orderToken,
  }).content, orderToken);
});

test("UT-SRC-06: rendered content uses the current record and supports multiple tokens", () => {
  const result = codec().toRenderedContent(
    `订单：${orderToken}，客户：${customerToken}，日期：@${SYSTEM_PRINT_DATE_ID}`,
    {
      [fieldDataSourceId("order-no")]: "PO-0001",
      [fieldDataSourceId("customer")]: "甲公司",
      [SYSTEM_PRINT_DATE_ID]: "2026-09-26",
    },
  );

  assert.equal(result.content, "订单：PO-0001，客户：甲公司，日期：2026-09-26");
  assert.deepEqual(result.issues, []);
});

test("UT-SRC-06: system labels round-trip and unavailable field values are explicit", () => {
  const source = `日期：@${SYSTEM_PRINT_DATE_ID}，订单：${orderToken}`;
  const current = codec();
  const editing = current.toEditingContent(source);
  assert.equal(editing.content, "日期：@打印日期，订单：@订单编号");
  assert.equal(current.toPersistentContent(editing.content, { previousContent: source }).content, source);

  const rendered = current.toRenderedContent(source, { [SYSTEM_PRINT_DATE_ID]: "2026-09-26" });
  assert.equal(rendered.content, "日期：2026-09-26，订单：[字段不可读取：订单编号]");
  assert.deepEqual(rendered.issues, [{ kind: "unavailable", label: "订单编号", token: orderToken }]);
});

test("UT-SRC-06: duplicate labels never guess a field and a recorded paste disambiguates it", () => {
  const duplicate = createDataSourceTokenCodec([
    { id: fieldDataSourceId("first"), label: "编号" },
    { id: fieldDataSourceId("second"), label: "编号" },
  ]);
  const ambiguous = duplicate.toPersistentContent("@编号");
  assert.equal(ambiguous.content, "@编号");
  assert.equal(ambiguous.issues[0]?.kind, "ambiguous");

  const pastedBindings: PastedDataSourceBinding[] = [{
    label: "编号",
    token: `@${fieldDataSourceId("second")}`,
  }];
  const resolved = duplicate.toPersistentContent("@编号", { pastedBindings });
  assert.equal(resolved.content, `@${fieldDataSourceId("second")}`);
  assert.deepEqual(resolved.issues, []);
});

test("UT-SRC-06: a same-name paste before an existing reference keeps each field ID", () => {
  const first = `@${fieldDataSourceId("first")}`;
  const second = `@${fieldDataSourceId("second")}`;
  const duplicate = createDataSourceTokenCodec([
    { id: fieldDataSourceId("first"), label: "编号" },
    { id: fieldDataSourceId("second"), label: "编号" },
  ]);

  const inserted = duplicate.toPersistentContent("@编号 / @编号", {
    previousContent: first,
    pastedBindings: [{ label: "编号", token: second, offset: 0 }],
  });
  assert.equal(inserted.content, `${second} / ${first}`);
  assert.deepEqual(inserted.issues, []);

  const replaced = duplicate.toPersistentContent("@编号", {
    previousContent: first,
    pastedBindings: [{ label: "编号", token: second, offset: 0 }],
  });
  assert.equal(replaced.content, second);
  assert.deepEqual(replaced.issues, []);

  const unverified = duplicate.toPersistentContent("@编号 / @编号", {
    previousContent: first,
    pastedBindings: [{ label: "编号", token: second, offset: 3 }],
  });
  assert.equal(unverified.issues[0]?.kind, "ambiguous");
});

test("UT-SRC-06: deleted fields show an explicit invalid label and preserve their ID", () => {
  const deletedToken = `@${fieldDataSourceId("deleted")}`;
  const current = createDataSourceTokenCodec([
    { id: fieldDataSourceId("order-no"), label: "订单编号" },
  ], { deleted: "旧字段" });

  const editing = current.toEditingContent(`值：${deletedToken}`);
  assert.equal(editing.content, "值：@旧字段（字段已失效）");
  assert.equal(editing.issues[0]?.kind, "missing");
  assert.ok(!editing.content.includes("__duowei"));
  assert.equal(current.toPersistentContent(editing.content, {
    previousContent: `值：${deletedToken}`,
  }).content, `值：${deletedToken}`);
  assert.equal(current.toRenderedContent(`值：${deletedToken}`, {}).content,
    "值：[字段已失效：旧字段]");
});
