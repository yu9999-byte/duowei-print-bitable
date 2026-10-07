type StoredValue = unknown;

const storage = new Map<string, StoredValue>();

const records: Record<string, Record<string, string>> = {
  rec001: {
    fldOrder: "DW-2026-001",
    fldCustomer: "远山科技",
    fldProduct: "工业标签打印机",
    fldQuantity: "2",
    fldAmount: "¥ 4,980.00",
    fldAddress: "上海市浦东新区张江路 88 号",
  },
  rec002: {
    fldOrder: "DW-2026-002",
    fldCustomer: "海川设计",
    fldProduct: "热敏标签纸",
    fldQuantity: "12",
    fldAmount: "¥ 1,188.00",
    fldAddress: "杭州市余杭区文一西路 969 号",
  },
  rec003: {
    fldOrder: "DW-2026-003",
    fldCustomer: "青禾商贸",
    fldProduct: "条码扫描器",
    fldQuantity: "4",
    fldAmount: "¥ 2,760.00",
    fldAddress: "苏州市工业园区星湖街 328 号",
  },
};

const fields = [
  { id: "fldOrder", name: "订单编号", type: 1, isPrimary: true },
  { id: "fldCustomer", name: "客户名称", type: 1 },
  { id: "fldProduct", name: "商品名称", type: 1 },
  { id: "fldQuantity", name: "数量", type: 2 },
  { id: "fldAmount", name: "订单金额", type: 2 },
  { id: "fldAddress", name: "收货地址", type: 1 },
];

const table = {
  async getFieldMetaList() {
    return fields;
  },
  async getName() {
    return "订单管理";
  },
  async getRecordById(recordId: string) {
    return { fields: records[recordId] ?? {} };
  },
  async getViewMetaList() {
    return [];
  },
  async getViewById() {
    return undefined;
  },
  async getViewList() {
    return [];
  },
  async getFieldById(fieldId: string) {
    return {
      async getCellString(recordId: string) {
        return records[recordId]?.[fieldId] ?? "";
      },
    };
  },
};

const selection = {
  baseId: "basVisualReview",
  tableId: "tblOrders",
  viewId: "vewAllOrders",
  recordId: "rec001",
};

export const FieldType = {
  SingleLink: 18,
  DuplexLink: 21,
};

export const bitable = {
  base: {
    async getSelection() {
      return selection;
    },
    async getTable() {
      return table;
    },
    onSelectionChange() {
      return () => undefined;
    },
  },
  bridge: {
    async getData<T>(key: string): Promise<T | null> {
      return (storage.get(key) as T | undefined) ?? null;
    },
    async setData<T>(key: string, value: T): Promise<boolean> {
      storage.set(key, value);
      return true;
    },
  },
  ui: {
    async selectRecordIdList() {
      return ["rec001", "rec002", "rec003"];
    },
  },
};

