export type DesignerComponentType =
  | "text"
  | "image"
  | "pageNumber"
  | "table"
  | "barcode"
  | "qrcode"
  | "line"
  | "rect"
  | "circle";

export type DesignerComponentItem = {
  type: DesignerComponentType;
  label: string;
  symbol: string;
  description: string;
};

export const DESIGNER_COMPONENT_GROUPS: ReadonlyArray<{
  id: "basic" | "data" | "shapes";
  label: string;
  items: readonly DesignerComponentItem[];
}> = [
  {
    id: "basic",
    label: "基础",
    items: [
      { type: "text", label: "文本", symbol: "文", description: "文字与字段内容" },
      { type: "image", label: "图片", symbol: "图", description: "图片地址或图片字段" },
      { type: "pageNumber", label: "页码", symbol: "页", description: "当前页与总页数" },
    ],
  },
  {
    id: "data",
    label: "数据与编码",
    items: [
      { type: "table", label: "表格", symbol: "表", description: "明细与数组数据" },
      { type: "barcode", label: "条形码", symbol: "条", description: "编码内容或字段" },
      { type: "qrcode", label: "二维码", symbol: "码", description: "文本、链接或字段" },
    ],
  },
  {
    id: "shapes",
    label: "形状",
    items: [
      { type: "line", label: "横线", symbol: "线", description: "内容分隔线" },
      { type: "rect", label: "矩形", symbol: "框", description: "边框与区块" },
      { type: "circle", label: "圆形", symbol: "圆", description: "圆形与椭圆形" },
    ],
  },
] as const;

export const DESIGNER_COMPONENTS = DESIGNER_COMPONENT_GROUPS.flatMap((group) => group.items);
