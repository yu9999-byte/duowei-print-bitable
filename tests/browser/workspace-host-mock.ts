type StoredValue = unknown;

const storage = new Map<string, StoredValue>();
const query = new URLSearchParams(window.location.search);
const persistentStorageNamespace = query.get("storage");

function browserStorageKey(key: string): string {
  return `duowei-print-workspace:${persistentStorageNamespace}:${key}`;
}

function readStoredValue<T>(key: string): T | null {
  if (!persistentStorageNamespace) {
    return (storage.get(key) as T | undefined) ?? null;
  }
  const serialized = window.sessionStorage.getItem(browserStorageKey(key));
  if (serialized === null) return null;
  try {
    return JSON.parse(serialized) as T;
  } catch {
    return null;
  }
}

function writeStoredValue<T>(key: string, value: T): boolean {
  if (!persistentStorageNamespace) {
    storage.set(key, value);
    return true;
  }
  window.sessionStorage.setItem(browserStorageKey(key), JSON.stringify(value));
  return true;
}

const customerNames = [
  "远山科技",
  "海川设计",
  "青禾商贸",
  "北辰制造",
  "云帆物流",
  "启明零售",
  "新岸电子",
  "木棉家居",
  "远景包装",
  "星河食品",
];

const productNames = [
  "工业标签打印机",
  "热敏标签纸",
  "条码扫描器",
  "仓储周转箱",
  "便携式打印机",
  "标签碳带",
  "无线扫码枪",
  "商品价签纸",
  "物流面单纸",
  "冷链标签",
];

const records = Object.fromEntries(
  Array.from({ length: 10 }, (_, index) => {
    const sequence = index + 1;
    const recordId = `rec${String(sequence).padStart(3, "0")}`;
    return [
      recordId,
      {
        fldOrder: `DW-2026-${String(sequence).padStart(3, "0")}`,
        fldCustomer: customerNames[index],
        fldProduct: productNames[index],
        fldQuantity: String(sequence * 2),
        fldAmount: `¥ ${(sequence * 1188).toLocaleString("zh-CN")}.00`,
        fldAddress: `测试收货地址 ${sequence} 号`,
      },
    ];
  }),
) as Record<string, Record<string, string>>;

const selectedRecordCount = Math.min(
  10,
  Math.max(1, Number(query.get("records")) || 3),
);
const selectedRecordIds = Array.from(
  { length: selectedRecordCount },
  (_, index) => `rec${String(index + 1).padStart(3, "0")}`,
);

const fields = [
  { id: "fldOrder", name: "订单编号", type: 1, isPrimary: true },
  { id: "fldCustomer", name: "客户名称", type: 1 },
  { id: "fldProduct", name: "商品名称", type: 1 },
  { id: "fldQuantity", name: "数量", type: 2 },
  { id: "fldAmount", name: "订单金额", type: 2 },
  { id: "fldAddress", name: "收货地址", type: 1 },
];

const showDetails = query.get("details") === "1";
const detailMeta = [
  { id: "lineProduct", name: "商品名称", type: 1 },
  { id: "lineQty", name: "数量", type: 2 },
  { id: "linePrice", name: "单价", type: 2 },
];
if (showDetails) fields.push(
  { id: "fldLines", name: "商品明细", type: 18, property: { tableId: "tblLines", multiple: true } } as any,
  { id: "fldPayments", name: "收款记录", type: 21, property: { tableId: "tblLines", multiple: true } } as any,
);
const detailTable = {
  async getViewList() { return [{ async getFieldMetaList() { return detailMeta; } }]; },
  async getRecordById() { return { fields: {} }; },
  async getFieldById(id: string) { return { async getCellString(recordId: string) {
    const suffix = recordId.endsWith("2") ? 2 : 1;
    return id === "lineProduct" ? ["热敏标签纸", "条码扫描器"][suffix - 1] : id === "lineQty" ? String(suffix * 2) : "128.00";
  } }; },
};

const table = {
  async getFieldMetaList() {
    return fields;
  },
  async getName() {
    return "订单管理";
  },
  async getRecordById(recordId: string) {
    return { fields: { ...records[recordId], ...(showDetails ? {
      fldLines: { tableId: "tblLines", recordIds: ["line1", "line2"] },
      fldPayments: { tableId: "tblLines", recordIds: ["line1"] },
    } : {}) } };
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
    async getTable(tableId?: string) {
      return tableId === "tblLines" ? detailTable : table;
    },
    onSelectionChange() {
      return () => undefined;
    },
  },
  bridge: {
    async getData<T>(key: string): Promise<T | null> {
      return readStoredValue<T>(key);
    },
    async setData<T>(key: string, value: T): Promise<boolean> {
      return writeStoredValue(key, value);
    },
  },
  ui: {
    async selectRecordIdList() {
      return selectedRecordIds;
    },
  },
};
