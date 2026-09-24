import assert from "node:assert/strict";
import test from "node:test";
import { bitable } from "@lark-base-open/js-sdk";
import { loadPrintJob } from "../src/host/bitable-gateway.ts";

type GetTable = typeof bitable.base.getTable;

function installBaseFixture(
  linkType: 18 | 21,
  recordIds: unknown[],
  unreadableFieldId?: string,
) {
  const recordReads: Array<[string, boolean | undefined]> = [];
  const linkedFields = [
    { id: "line-product", name: "产品", type: 1 },
    { id: "line-qty", name: "数量", type: 2 },
    { id: "line-price", name: "单价", type: 2 },
    { id: "line-note", name: "备注", type: 1 },
    { id: "line-batch", name: "批次", type: 1 },
    { id: "line-internal", name: "内部字段", type: 1 },
  ];
  const values: Record<string, Record<string, string>> = {
    "line-2": {
      "line-product": "鼠标",
      "line-qty": "5",
      "line-price": "200",
      "line-note": "",
      "line-batch": "B",
    },
    "line-1": {
      "line-product": "笔记本",
      "line-qty": "2",
      "line-price": "5000",
      "line-note": "加急",
      "line-batch": "A",
    },
  };
  const linkedTable = {
    async getViewList() {
      return [{ async getFieldMetaList() { return linkedFields; } }];
    },
    async getFieldById(fieldId: string) {
      return {
        async getCellString(recordId: string) {
          if (fieldId === unreadableFieldId) throw new Error("无字段权限");
          if (!values[recordId]) throw new Error("missing:" + recordId);
          return values[recordId][fieldId] ?? "";
        },
      };
    },
    async getRecordById(recordId: string) {
      if (!values[recordId]) throw new Error("missing:" + recordId);
      return { fields: values[recordId] };
    },
  };
  const mainTable = {
    async getFieldMetaList() {
      return [
        { id: "customer", name: "客户", type: 1 },
        {
          id: "lines",
          name: "明细",
          type: linkType,
          property: { tableId: "table-lines", multiple: true },
        },
      ];
    },
    async getName() { return "订单"; },
    async getFieldById(fieldId: string) {
      if (fieldId !== "customer") throw new Error("unexpected-main-field:" + fieldId);
      return { async getCellString() { return "甲公司"; } };
    },
    async getRecordById(recordId: string, refreshLinkValue?: boolean) {
      recordReads.push([recordId, refreshLinkValue]);
      return {
        fields: {
          customer: { raw: "不应直接打印的对象" },
          lines: {
            tableId: "table-lines",
            recordIds,
            text: "鼠标,笔记本",
          },
        },
      };
    },
  };
  const getTable = (async (tableId: string) => {
    if (tableId === "table-orders") return mainTable;
    if (tableId === "table-lines") return linkedTable;
    throw new Error("unexpected-table:" + tableId);
  }) as unknown as GetTable;
  return { getTable, recordReads };
}

for (const linkType of [18, 21] as const) {
  test(`SPEC-LINK-01/02: gateway expands field type ${linkType} with target-view order`, async () => {
    const originalGetTable = bitable.base.getTable;
    const fixture = installBaseFixture(linkType, ["line-2", "line-1"]);
    bitable.base.getTable = fixture.getTable;
    try {
      const job = await loadPrintJob(
        { baseId: "base-test", tableId: "table-orders", viewId: "view-orders" },
        ["order-1"],
      );

      assert.deepEqual(fixture.recordReads, [["order-1", true]]);
      assert.deepEqual(job.table.fields[1], {
        id: "lines",
        name: "明细",
        type: String(linkType),
        isLink: true,
        arrayColumns: [
          { field: "产品", header: "产品" },
          { field: "数量", header: "数量" },
          { field: "单价", header: "单价" },
          { field: "备注", header: "备注" },
          { field: "批次", header: "批次" },
        ],
      });
      assert.deepEqual(job.documents[0].values.明细, [
        { 产品: "鼠标", 数量: "5", 单价: "200", 备注: "", 批次: "B" },
        { 产品: "笔记本", 数量: "2", 单价: "5000", 备注: "加急", 批次: "A" },
      ]);
    } finally {
      bitable.base.getTable = originalGetTable;
    }
  });
}

test("SPEC-LINK-03: gateway keeps link columns when the current record has no linked rows", async () => {
  const originalGetTable = bitable.base.getTable;
  const fixture = installBaseFixture(18, []);
  bitable.base.getTable = fixture.getTable;
  try {
    const job = await loadPrintJob(
      { baseId: "base-test", tableId: "table-orders", viewId: "view-orders" },
      ["order-1"],
    );
    assert.deepEqual(job.documents[0].values.明细, []);
    assert.equal(job.table.fields[1].arrayColumns?.length, 5);
  } finally {
    bitable.base.getTable = originalGetTable;
  }
});

test("SPEC-DATA-02: malformed link IDs fail instead of silently dropping detail rows", async () => {
  const originalGetTable = bitable.base.getTable;
  const fixture = installBaseFixture(18, ["line-1", null]);
  bitable.base.getTable = fixture.getTable;
  try {
    await assert.rejects(
      () => loadPrintJob(
        { baseId: "base-test", tableId: "table-orders", viewId: "view-orders" },
        ["order-1"],
      ),
      { message: "关联字段记录 ID 无效：明细" },
    );
  } finally {
    bitable.base.getTable = originalGetTable;
  }
});

test("SPEC-DATA-02: an unreadable linked field degrades while other detail cells remain", async () => {
  const originalGetTable = bitable.base.getTable;
  const fixture = installBaseFixture(18, ["line-1"], "line-price");
  bitable.base.getTable = fixture.getTable;
  try {
    const job = await loadPrintJob(
      { baseId: "base-test", tableId: "table-orders", viewId: "view-orders" },
      ["order-1"],
    );
    assert.deepEqual(job.documents[0].values.明细, [{
      产品: "笔记本",
      数量: "2",
      单价: "【字段不可读取：单价（无字段权限）】",
      备注: "加急",
      批次: "A",
    }]);
  } finally {
    bitable.base.getTable = originalGetTable;
  }
});

test("SPEC-DATA-02: an inaccessible linked record blocks the entire job", async () => {
  const originalGetTable = bitable.base.getTable;
  const fixture = installBaseFixture(18, ["line-1", "missing"]);
  bitable.base.getTable = fixture.getTable;
  try {
    await assert.rejects(
      () => loadPrintJob(
        { baseId: "base-test", tableId: "table-orders", viewId: "view-orders" },
        ["order-1"],
      ),
      { message: "关联记录读取失败：missing" },
    );
  } finally {
    bitable.base.getTable = originalGetTable;
  }
});

test("SPEC-DATA-01: gateway uses SDK-readable text instead of serializing raw field objects", async () => {
  const originalGetTable = bitable.base.getTable;
  const mainTable = {
    async getFieldMetaList() {
      return [
        { id: "customer", name: "客户", type: 1 },
        { id: "owners", name: "负责人", type: 11 },
      ];
    },
    async getName() { return "订单"; },
    async getRecordById() {
      return {
        fields: {
          customer: [{ type: "text", text: "甲公司" }],
          owners: [{ id: "u1", name: "张三" }, { id: "u2", name: "李四" }],
        },
      };
    },
    async getFieldById(fieldId: string) {
      const readable: Record<string, string> = {
        customer: "甲公司",
        owners: "张三、李四",
      };
      return { async getCellString() { return readable[fieldId]; } };
    },
  };
  bitable.base.getTable = (async () => mainTable) as unknown as GetTable;
  try {
    const job = await loadPrintJob(
      { baseId: "base-test", tableId: "table-orders", viewId: "view-orders" },
      ["order-1"],
    );
    assert.deepEqual(job.documents[0].values, { 客户: "甲公司", 负责人: "张三、李四" });
  } finally {
    bitable.base.getTable = originalGetTable;
  }
});

test("SPEC-DATA-02: an unreadable non-core field degrades explicitly without hiding readable fields", async () => {
  const originalGetTable = bitable.base.getTable;
  const mainTable = {
    async getFieldMetaList() {
      return [
        { id: "customer", name: "客户", type: 1 },
        { id: "restricted", name: "内部按钮", type: 3001 },
      ];
    },
    async getName() { return "订单"; },
    async getRecordById() { return { fields: { customer: "甲公司", restricted: {} } }; },
    async getFieldById(fieldId: string) {
      return {
        async getCellString() {
          if (fieldId === "restricted") throw new Error("无读取权限");
          return "甲公司";
        },
      };
    },
  };
  bitable.base.getTable = (async () => mainTable) as unknown as GetTable;
  try {
    const job = await loadPrintJob(
      { baseId: "base-test", tableId: "table-orders", viewId: "view-orders" },
      ["order-1"],
    );
    assert.deepEqual(job.documents[0].values, {
      客户: "甲公司",
      内部按钮: "【字段不可读取：内部按钮（无读取权限）】",
    });
  } finally {
    bitable.base.getTable = originalGetTable;
  }
});
