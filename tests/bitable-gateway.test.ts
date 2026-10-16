import assert from "node:assert/strict";
import test from "node:test";
import { bitable } from "@lark-base-open/js-sdk";
import { BitableReadTimeoutError, loadPrintJob } from "../src/host/bitable-gateway.ts";
import type { PrintJob } from "../src/core/print-job.ts";

function legacyDetailRows(job: PrintJob) {
  const columns = job.table.fields.find((field) => field.id === "lines")!.arrayColumns!;
  return (job.documents[0].values.明细 as Array<Record<string, unknown>>)
    .map((row) => Object.fromEntries(columns.map((column) => [column.field, row[column.field]])));
}

type GetTable = typeof bitable.base.getTable;

test("UT-BATCH-07: gateway preserves the SDK primary marker independently of field order", async () => {
  const originalGetTable = bitable.base.getTable;
  bitable.base.getTable = (async () => ({
    async getFieldMetaList() { return [
      { id: "customer", name: "客户", type: 1, isPrimary: false },
      { id: "number", name: "订单编号", type: 1, isPrimary: true },
    ]; },
    async getName() { return "订单"; },
    async getFieldById(fieldId: string) {
      return { async getCellString() { return fieldId === "number" ? "PO-0001" : "甲公司"; } };
    },
    async getRecordById() { return { fields: {} }; },
  })) as GetTable;
  try {
    const job = await loadPrintJob(
      { baseId: "base", tableId: "table", viewId: "view", recordId: "rec-1" }, ["rec-1"],
    );
    assert.equal(job.table.fields[0].isPrimary, false);
    assert.equal(job.table.fields[1].isPrimary, true);
  } finally {
    bitable.base.getTable = originalGetTable;
  }
});

function installBaseFixture(
  linkType: 18 | 21,
  recordIds: unknown[],
  unreadableFieldId?: string,
  multiple = true,
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
          property: { tableId: "table-lines", multiple },
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
  test(`detail source supports single-cardinality cross-table links of type ${linkType}`, async () => {
    const originalGetTable = bitable.base.getTable;
    bitable.base.getTable = installBaseFixture(linkType, ["line-1"], undefined, false).getTable;
    try {
      const job = await loadPrintJob({ baseId: "base", tableId: "table-orders" }, ["order-1"]);
      assert.equal(job.table.fields[1].linkKind, "detail");
      assert.equal(job.table.fields[1].detailColumns?.length, 6);
      assert.equal((job.documents[0].values.明细 as Array<Record<string, string>>)[0]["__duowei_column_line-product"], "笔记本");
    } finally { bitable.base.getTable = originalGetTable; }
  });
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
      const { detailColumns, ...legacyField } = job.table.fields[1];
      assert.equal(detailColumns?.length, 6);
      assert.deepEqual(detailColumns?.[5], { field: "__duowei_column_line-internal", header: "内部字段" });
      assert.deepEqual(legacyField, {
        id: "lines",
        name: "明细",
        type: String(linkType),
        isLink: true,
        linkKind: "detail",
        arrayColumns: [
          { field: "产品", header: "产品" },
          { field: "数量", header: "数量" },
          { field: "单价", header: "单价" },
          { field: "备注", header: "备注" },
          { field: "批次", header: "批次" },
        ],
      });
      assert.deepEqual(legacyDetailRows(job), [
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

test("SPEC-LINK-01: a single-value parent link stays readable text and never becomes a detail table", async () => {
  const originalGetTable = bitable.base.getTable;
  const mainTable = {
    async getFieldMetaList() { return [{
      id: "parent",
      name: "父记录",
      type: 18,
      property: { tableId: "table-orders", multiple: false },
    }]; },
    async getName() { return "订单"; },
    async getRecordById() {
      return { fields: { parent: { tableId: "table-orders", recordIds: ["order-0"], text: "PO-0001" } } };
    },
    async getFieldById() {
      return { async getCellString() { return "PO-0001"; } };
    },
  };
  bitable.base.getTable = (async () => mainTable) as unknown as GetTable;
  try {
    const job = await loadPrintJob(
      { baseId: "base-test", tableId: "table-orders", viewId: "view-orders" },
      ["order-1"],
    );
    assert.deepEqual(job.table.fields[0], {
      id: "parent",
      name: "父记录",
      type: "18",
      isLink: true,
      linkKind: "reference",
    });
    assert.equal(job.documents[0].values.父记录, "PO-0001");
  } finally {
    bitable.base.getTable = originalGetTable;
  }
});

test("SPEC-LINK-01: a one-way self-link parent remains text when the SDK reports multiple true", async () => {
  const originalGetTable = bitable.base.getTable;
  const mainTable = {
    async getFieldMetaList() { return [{
      id: "parent",
      name: "父记录",
      type: 18,
      property: { tableId: "table-orders", multiple: true },
    }]; },
    async getName() { return "订单"; },
    async getViewList() { return [{
      async getFieldMetaList() { return [{ id: "number", name: "订单编号", type: 1 }]; },
    }]; },
    async getRecordById(recordId: string) {
      if (recordId === "order-0") return { fields: { number: "PO-0001" } };
      return {
        fields: {
          parent: { tableId: "table-orders", recordIds: ["order-0"], text: "PO-0001" },
        },
      };
    },
    async getFieldById(fieldId: string) {
      return {
        async getCellString(recordId: string) {
          if (fieldId === "parent" && recordId === "order-1") return "PO-0001";
          if (fieldId === "number" && recordId === "order-0") return "PO-0001";
          return "";
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
    assert.deepEqual(job.table.fields[0], {
      id: "parent",
      name: "父记录",
      type: "18",
      isLink: true,
      linkKind: "reference",
    });
    assert.equal(job.documents[0].values.父记录, "PO-0001");
  } finally {
    bitable.base.getTable = originalGetTable;
  }
});

test("SPEC-LINK-01: an empty single-value parent link uses an explicit empty value", async () => {
  const originalGetTable = bitable.base.getTable;
  const mainTable = {
    async getFieldMetaList() { return [{
      id: "parent", name: "父记录", type: 18,
      property: { tableId: "table-orders", multiple: true },
    }]; },
    async getName() { return "订单"; },
    async getRecordById() { return { fields: { parent: null } }; },
    async getFieldById() { return { async getCellString() { return ""; } }; },
  };
  bitable.base.getTable = (async () => mainTable) as unknown as GetTable;
  try {
    const job = await loadPrintJob(
      { baseId: "base-test", tableId: "table-orders", viewId: "view-orders" },
      ["order-1"],
    );
    assert.equal(job.table.fields[0].linkKind, "reference");
    assert.equal(job.documents[0].values.父记录, "—");
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

test("SPEC-LINK-01: duplicate link IDs fail instead of duplicating a detail row", async () => {
  const originalGetTable = bitable.base.getTable;
  const fixture = installBaseFixture(18, ["line-1", "line-1"]);
  bitable.base.getTable = fixture.getTable;
  try {
    await assert.rejects(
      () => loadPrintJob(
        { baseId: "base-test", tableId: "table-orders", viewId: "view-orders" },
        ["order-1"],
      ),
      { message: "关联字段包含重复记录 ID：明细（line-1）" },
    );
  } finally {
    bitable.base.getTable = originalGetTable;
  }
});

test("SPEC-LINK-03: an unavailable linked-table view fails explicitly", async () => {
  const originalGetTable = bitable.base.getTable;
  const fixture = installBaseFixture(18, ["line-1"]);
  bitable.base.getTable = (async (tableId: string) => {
    const table = await fixture.getTable(tableId);
    if (tableId !== "table-lines") return table;
    return { ...table, async getViewList() { return []; } };
  }) as unknown as GetTable;
  try {
    await assert.rejects(
      () => loadPrintJob(
        { baseId: "base-test", tableId: "table-orders", viewId: "view-orders" },
        ["order-1"],
      ),
      { message: "关联表缺少可用视图：table-lines" },
    );
  } finally {
    bitable.base.getTable = originalGetTable;
  }
});

test("SPEC-LINK-03: a linked-record timeout remains retryable", async () => {
  const originalGetTable = bitable.base.getTable;
  const fixture = installBaseFixture(18, ["line-1"]);
  bitable.base.getTable = (async (tableId: string) => {
    const table = await fixture.getTable(tableId);
    if (tableId !== "table-lines") return table;
    return { ...table, getRecordById() { return new Promise<never>(() => undefined); } };
  }) as unknown as GetTable;
  try {
    await assert.rejects(
      () => loadPrintJob(
        { baseId: "base-test", tableId: "table-orders", viewId: "view-orders" },
        ["order-1"],
        { timeoutMs: 10 },
      ),
      (error: unknown) => error instanceof BitableReadTimeoutError
        && /读取关联记录/.test(error.message),
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
    assert.deepEqual(legacyDetailRows(job), [{
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

test("SPEC-SRC-06: gateway preserves each SDK field id/name pair for the data-source catalog", async () => {
  const originalGetTable = bitable.base.getTable;
  const realFieldPairs = [
    { id: "fld1PG2I15", name: "订单编号", type: 1 },
    { id: "fld47snZ5u", name: "备注", type: 1 },
  ];
  const readable: Record<string, string> = {
    fld1PG2I15: "PO-0003",
    fld47snZ5u: "拣货中，预计今日完成",
  };
  const mainTable = {
    async getFieldMetaList() { return realFieldPairs; },
    async getName() { return "仓库订单表"; },
    async getRecordById() {
      return { fields: { fld1PG2I15: readable.fld1PG2I15, fld47snZ5u: readable.fld47snZ5u } };
    },
    async getFieldById(fieldId: string) {
      return { async getCellString() { return readable[fieldId]; } };
    },
  };
  bitable.base.getTable = (async () => mainTable) as unknown as GetTable;
  try {
    const job = await loadPrintJob(
      { baseId: "CjjybEbM8aL9rlsGhfocfRCMnFe", tableId: "tblUdB1VhaFIkGKu", viewId: "vewOpp6hYu" },
      ["recvvQJTxlBFyZ"],
    );
    assert.deepEqual(job.table.fields, realFieldPairs.map((field) => ({
      id: field.id,
      name: field.name,
      type: String(field.type),
    })));
    assert.deepEqual(job.documents[0].values, {
      订单编号: "PO-0003",
      备注: "拣货中，预计今日完成",
    });
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

test("UT-BATCH-06: 50 out-of-order record reads stay bounded and retain selection order", async () => {
  const originalGetTable = bitable.base.getTable;
  const selectedIds = Array.from({ length: 50 }, (_, index) => `order-${index}`);
  let active = 0;
  let peak = 0;
  const mainTable = {
    async getFieldMetaList() { return [{ id: "number", name: "订单编号", type: 1 }]; },
    async getName() { return "订单"; },
    async getRecordById(recordId: string) {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, Number(recordId.slice(6)) % 3));
      active -= 1;
      return { fields: { number: recordId } };
    },
    async getFieldById() {
      return { async getCellString(recordId: string) { return recordId; } };
    },
  };
  bitable.base.getTable = (async () => mainTable) as unknown as GetTable;
  try {
    const job = await loadPrintJob(
      { baseId: "base-test", tableId: "table-orders", viewId: "view-orders" },
      selectedIds,
    );
    assert.equal(peak, 4);
    assert.deepEqual(job.documents.map((document) => document.recordId), selectedIds);
    assert.deepEqual(job.documents.map((document) => document.values.订单编号), selectedIds);
  } finally {
    bitable.base.getTable = originalGetTable;
  }
});

test("UT-BATCH-06: a failed core record drains in-flight reads without dispatching the rest", async () => {
  const originalGetTable = bitable.base.getTable;
  const started: string[] = [];
  const finished: string[] = [];
  const mainTable = {
    async getFieldMetaList() { return [{ id: "number", name: "订单编号", type: 1 }]; },
    async getName() { return "订单"; },
    async getRecordById(recordId: string) {
      started.push(recordId);
      await new Promise((resolve) => setTimeout(resolve, recordId === "order-0" ? 1 : 15));
      finished.push(recordId);
      if (recordId === "order-0") throw new Error("记录不可读取");
      return { fields: { number: recordId } };
    },
    async getFieldById() {
      return { async getCellString(recordId: string) { return recordId; } };
    },
  };
  bitable.base.getTable = (async () => mainTable) as unknown as GetTable;
  try {
    await assert.rejects(
      () => loadPrintJob(
        { baseId: "base-test", tableId: "table-orders", viewId: "view-orders" },
        Array.from({ length: 8 }, (_, index) => `order-${index}`),
      ),
      { message: "记录不可读取" },
    );
    assert.deepEqual(started, ["order-0", "order-1", "order-2", "order-3"]);
    assert.equal(finished.length, 4);
  } finally {
    bitable.base.getTable = originalGetTable;
  }
});

test("UT-BATCH-08: a hanging record read fails within the configured timeout", async () => {
  const originalGetTable = bitable.base.getTable;
  const mainTable = {
    async getFieldMetaList() { return [{ id: "number", name: "订单编号", type: 1 }]; },
    async getName() { return "订单"; },
    getRecordById() { return new Promise<never>(() => undefined); },
    async getFieldById() {
      return { async getCellString() { return "不会执行"; } };
    },
  };
  bitable.base.getTable = (async () => mainTable) as unknown as GetTable;
  try {
    await assert.rejects(
      () => loadPrintJob(
        { baseId: "base-test", tableId: "table-orders", viewId: "view-orders" },
        ["order-1"],
        { timeoutMs: 10 },
      ),
      { message: /读取多维表格数据超时：读取记录/ },
    );
  } finally {
    bitable.base.getTable = originalGetTable;
  }
});

test("UT-BATCH-08: a hanging field read fails instead of being treated as an unreadable field", async () => {
  const originalGetTable = bitable.base.getTable;
  const mainTable = {
    async getFieldMetaList() { return [{ id: "number", name: "订单编号", type: 1 }]; },
    async getName() { return "订单"; },
    async getRecordById() { return { fields: { number: "order-1" } }; },
    async getFieldById() {
      return { getCellString() { return new Promise<never>(() => undefined); } };
    },
  };
  bitable.base.getTable = (async () => mainTable) as unknown as GetTable;
  try {
    await assert.rejects(
      () => loadPrintJob(
        { baseId: "base-test", tableId: "table-orders", viewId: "view-orders" },
        ["order-1"],
        { timeoutMs: 10 },
      ),
      { message: /读取多维表格数据超时：读取字段“订单编号”/ },
    );
  } finally {
    bitable.base.getTable = originalGetTable;
  }
});

test("UT-BATCH-09: a timed-out read does not prevent a successful retry", async () => {
  const originalGetTable = bitable.base.getTable;
  let resolveFirst: ((value: { fields: Record<string, string> }) => void) | undefined;
  let reads = 0;
  const mainTable = {
    async getFieldMetaList() { return [{ id: "number", name: "订单编号", type: 1 }]; },
    async getName() { return "订单"; },
    getRecordById(recordId: string) {
      if (++reads === 1) {
        return new Promise<{ fields: Record<string, string> }>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({ fields: { number: recordId } });
    },
    async getFieldById() {
      return { async getCellString(recordId: string) { return `PO-${recordId}`; } };
    },
  };
  bitable.base.getTable = (async () => mainTable) as unknown as GetTable;
  try {
    const selection = { baseId: "base-test", tableId: "table-orders", viewId: "view-orders" };
    await assert.rejects(
      () => loadPrintJob(selection, ["order-1"], { timeoutMs: 50 }),
      { message: /读取多维表格数据超时：读取记录/ },
    );
    const retried = await loadPrintJob(selection, ["order-2"], { timeoutMs: 50 });
    assert.equal(reads, 2);
    assert.deepEqual(retried.source.recordIds, ["order-2"]);
    assert.equal(retried.documents[0].values["订单编号"], "PO-order-2");
    resolveFirst?.({ fields: { number: "order-1" } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(retried.documents[0].values["订单编号"], "PO-order-2");
  } finally {
    bitable.base.getTable = originalGetTable;
  }
});
