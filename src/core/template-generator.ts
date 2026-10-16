import { isDetailLinkField, type PrintJob, type NormalizedField, type PrintableValue } from "./print-job.ts";
import {
  buildDataSourceCatalog,
  fieldDataSourceId,
  detailFieldDataSourceId,
  type DesignerDataSourceGroup,
} from "./data-sources.ts";

export type TemplateElement = {
  id: string;
  type: "text" | "table" | "line" | "multiLabel";
  x: number;
  y: number;
  width: number;
  height: number;
  content?: string;
  variable?: string;
  printable: boolean;
  style: Record<string, unknown>;
  [key: string]: unknown;
};

export type DesignerTemplate = {
  pages: Array<{ id: string; elements: TemplateElement[] }>;
  canvasSize: { width: number; height: number };
  unit: "px";
  showGrid: boolean;
  allowDragOutsideCanvas: boolean;
  ext: {
    availableVariables: DesignerDataSourceGroup[];
    fieldBindings: Record<string, string>;
    batchLayout?: "continuous";
  };
};

const PAGE_WIDTH = 794;
const PAGE_HEIGHT = 1123;
const SIDE_MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - SIDE_MARGIN * 2;
const FIELD_WIDTH = 336;
const FIELD_HEIGHT = 34;
const ROW_GAP = 12;
const CONTENT_BOTTOM = PAGE_HEIGHT - 100;
const variable = (name: string) => "@" + name;
const autoId = (prefix: string, index: number) => "auto-" + prefix + "-" + (index + 1);
const LONG_TEXT_THRESHOLD = 60;

export function generateBlankTemplate(job: Pick<PrintJob, "table" | "documents">): DesignerTemplate {
  return {
    pages: [{ id: "blank-page-1", elements: [] }],
    canvasSize: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
    unit: "px",
    showGrid: true,
    allowDragOutsideCanvas: false,
    ext: {
      availableVariables: buildDataSourceCatalog(job.table.fields),
      fieldBindings: Object.fromEntries(job.table.fields.map((field) => [field.id, field.name])),
    },
  };
}

export function generateLabelTemplate(job: Pick<PrintJob, "table" | "documents">): DesignerTemplate {
  const fields = job.table.fields.filter((field) => !isDetailLinkField(field));
  if (!fields.length) throw new Error("当前表没有适合放入标签的普通字段");
  const selected = [fields.find((field) => field.isPrimary) ?? fields[0]];
  const second = fields.find((field) => field.id !== selected[0].id);
  if (second) selected.push(second);
  const content = selected.map((field) => `${field.name}：${variable(fieldDataSourceId(field.id))}`).join("\n");
  return {
    pages: [{ id: "label-page-1", elements: [
      {
        id: "label-grid", type: "multiLabel", x: 48, y: 48, width: 230, height: 160,
        rows: 3, cols: 2, gapX: 12, gapY: 12, direction: "row", dataVariable: "@labels",
        printable: true,
        style: { backgroundColor: "transparent", borderColor: "#9ca3af", borderStyle: "solid", borderWidth: 1 },
      },
      {
        id: "label-summary", type: "text", x: 60, y: 68, width: 205, height: 100,
        content, variable: variable(fieldDataSourceId(selected[0].id)), printable: true,
        style: { fontSize: 16, color: "#202124", backgroundColor: "transparent",
          borderColor: "transparent", textAlign: "left", verticalAlign: "middle" },
      },
    ] }],
    canvasSize: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
    unit: "px", showGrid: true, allowDragOutsideCanvas: false,
    ext: {
      availableVariables: buildDataSourceCatalog(job.table.fields),
      fieldBindings: Object.fromEntries(job.table.fields.map((field) => [field.id, field.name])),
    },
  };
}

export function generateContinuousTemplate(job: Pick<PrintJob, "table" | "documents">): DesignerTemplate {
  const fields = job.table.fields.filter((field) => !isDetailLinkField(field));
  if (!fields.length) throw new Error("当前表没有适合连续排版的普通字段");
  const elements: TemplateElement[] = [];
  let y = 28;
  elements.push({
    id: "continuous-title",
    type: "text",
    x: SIDE_MARGIN,
    y,
    width: CONTENT_WIDTH,
    height: 34,
    content: `${job.table.name}打印单`,
    printable: true,
    style: { fontSize: 20, fontWeight: "bold", color: "#111827", backgroundColor: "transparent",
      borderColor: "transparent", textAlign: "center", verticalAlign: "middle" },
  });
  y += 46;
  elements.push(line(y, "continuous-divider"));
  y += 22;

  for (let index = 0; index < fields.length; index += 2) {
    elements.push(fieldText(fields[index], index, SIDE_MARGIN, y));
    if (fields[index + 1]) {
      elements.push(fieldText(fields[index + 1], index + 1, SIDE_MARGIN + FIELD_WIDTH + 24, y));
    }
    y += FIELD_HEIGHT + ROW_GAP;
  }

  const canvasHeight = y + 28;
  return {
    pages: [{ id: "continuous-page-1", elements }],
    canvasSize: { width: PAGE_WIDTH, height: canvasHeight },
    unit: "px",
    showGrid: true,
    allowDragOutsideCanvas: false,
    ext: {
      batchLayout: "continuous",
      availableVariables: buildDataSourceCatalog(job.table.fields),
      fieldBindings: Object.fromEntries(job.table.fields.map((field) => [field.id, field.name])),
    },
  };
}

function isLongField(field: NormalizedField, documents: PrintJob["documents"]): boolean {
  if (field.isLongText !== undefined) return field.isLongText;
  return documents.some((document) => {
    const value = document.values[field.name];
    return typeof value === "string"
      && (value.includes("\n") || value.length > LONG_TEXT_THRESHOLD);
  });
}

function fieldText(field: NormalizedField, index: number, x: number, y: number): TemplateElement {
  const token = variable(fieldDataSourceId(field.id));
  return {
    id: autoId("field", index),
    type: "text",
    x,
    y,
    width: FIELD_WIDTH,
    height: FIELD_HEIGHT,
    content: field.name + "：" + token,
    variable: token,
    printable: true,
    style: {
      fontSize: 14,
      color: "#202124",
      backgroundColor: "transparent",
      borderColor: "transparent",
      textAlign: "left",
      verticalAlign: "middle",
    },
  };
}

function line(y: number, id = "auto-divider"): TemplateElement {
  return {
    id,
    type: "line",
    x: SIDE_MARGIN,
    y,
    width: CONTENT_WIDTH,
    height: 1,
    printable: true,
    style: { borderColor: "#202124", borderWidth: 1 },
  };
}

export function generateTemplate(job: Pick<PrintJob, "table" | "documents">): DesignerTemplate {
  const fields = job.table.fields;
  const linkFields = fields.filter(isDetailLinkField);
  const normalFields = fields.filter((field) => !linkFields.includes(field));
  const sample = job.documents[0]?.values ?? {};
  const longFields = normalFields.filter((field) => isLongField(field, job.documents));
  const shortFields = normalFields.filter((field) => !isLongField(field, job.documents));
  const pages: DesignerTemplate["pages"] = [{ id: "auto-page-1", elements: [] }];
  let elements = pages[0].elements;
  let y = 42;

  const startContinuationPage = () => {
    const pageNumber = pages.length + 1;
    const page = { id: `auto-page-${pageNumber}`, elements: [] as TemplateElement[] };
    pages.push(page);
    elements = page.elements;
    y = 42;
    elements.push({
      id: `auto-continuation-title-${pageNumber}`,
      type: "text",
      x: SIDE_MARGIN,
      y,
      width: CONTENT_WIDTH,
      height: 32,
      content: job.table.name + "打印单（续）",
      printable: true,
      style: {
        fontSize: 18,
        fontWeight: "bold",
        color: "#111827",
        backgroundColor: "transparent",
        borderColor: "transparent",
        textAlign: "left",
        verticalAlign: "middle",
      },
    });
    y += 44;
    elements.push(line(y, `auto-divider-${pageNumber}`));
    y += 24;
  };

  const ensureSpace = (height: number) => {
    if (y + height > CONTENT_BOTTOM) startContinuationPage();
  };

  elements.push({
    id: "auto-title",
    type: "text",
    x: SIDE_MARGIN,
    y,
    width: CONTENT_WIDTH,
    height: 42,
    content: job.table.name + "打印单",
    printable: true,
    style: {
      fontSize: 24,
      fontWeight: "bold",
      color: "#111827",
      backgroundColor: "transparent",
      borderColor: "transparent",
      textAlign: "center",
      verticalAlign: "middle",
    },
  });
  y += 58;
  elements.push(line(y));
  y += 24;

  let shortIndex = 0;
  for (let index = 0; index < shortFields.length; index += 2) {
    ensureSpace(FIELD_HEIGHT + ROW_GAP);
    elements.push(fieldText(shortFields[index], shortIndex++, SIDE_MARGIN, y));
    if (shortFields[index + 1]) {
      elements.push(fieldText(shortFields[index + 1], shortIndex++, SIDE_MARGIN + FIELD_WIDTH + 24, y));
    }
    y += FIELD_HEIGHT + ROW_GAP;
  }

  for (const field of longFields) {
    ensureSpace(70);
    const token = variable(fieldDataSourceId(field.id));
    elements.push({
      id: "auto-long-" + field.id,
      type: "text",
      x: SIDE_MARGIN,
      y,
      width: CONTENT_WIDTH,
      height: 58,
      content: field.name + "：" + token,
      variable: token,
      printable: true,
      style: {
        fontSize: 14,
        color: "#202124",
        backgroundColor: "transparent",
        borderColor: "transparent",
        textAlign: "left",
        verticalAlign: "top",
        whiteSpace: "pre-wrap",
        autoHeight: true,
      },
    });
    y += 70;
  }

  linkFields.forEach((field) => {
    ensureSpace(306);
    const token = variable(fieldDataSourceId(field.id));
    const emptyStateToken = variable("__duowei_print_empty_" + field.id);
    const columns = field.detailColumns?.length ? field.detailColumns.slice(0, 5) : field.arrayColumns?.length
      ? field.arrayColumns
      : [{ field: "value", header: field.name, width: CONTENT_WIDTH }];
    const sampleRows = Array.isArray(sample[field.name])
      ? (sample[field.name] as PrintableValue[]).slice(0, 1)
      : [];
    elements.push({
      id: "auto-link-title-" + field.id,
      type: "text",
      x: SIDE_MARGIN,
      y,
      width: CONTENT_WIDTH,
      height: 28,
      content: field.name,
      printable: true,
      style: { fontSize: 16, fontWeight: "bold", color: "#111827", backgroundColor: "transparent", borderColor: "transparent" },
    });
    y += 34;
    elements.push({
      id: "auto-link-empty-" + field.id,
      type: "text",
      x: SIDE_MARGIN,
      y,
      width: CONTENT_WIDTH,
      height: 24,
      content: emptyStateToken,
      variable: emptyStateToken,
      printable: true,
      style: {
        fontSize: 12,
        color: "#6b7280",
        backgroundColor: "transparent",
        borderColor: "transparent",
        textAlign: "left",
        verticalAlign: "middle",
      },
    });
    y += 28;
    elements.push({
      id: "auto-table-" + field.id,
      type: "table",
      x: SIDE_MARGIN,
      y,
      width: CONTENT_WIDTH,
      height: 220,
      variable: token,
      columns,
      data: field.detailColumns?.length ? [] : sampleRows,
      ...(field.detailColumns?.length ? { detailTemplateRows: [Object.fromEntries(columns.map((column) => [
        column.field, variable(detailFieldDataSourceId(field.id, column.field)),
      ]))] } : {}),
      showHeader: true,
      showFooter: false,
      tfootRepeat: true,
      autoPaginate: true,
      designOmitRows: true,
      printable: true,
      style: {
        backgroundColor: "transparent",
        borderColor: "#9ca3af",
        headerBackgroundColor: "#f3f4f6",
        headerColor: "#111827",
        textAlign: "left",
        headerTextAlign: "left",
        rowHeight: 32,
        headerHeight: 36,
      },
    });
    y += 244;
  });

  return {
    pages,
    canvasSize: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
    unit: "px",
    showGrid: true,
    allowDragOutsideCanvas: false,
    ext: {
      availableVariables: buildDataSourceCatalog(fields),
      fieldBindings: Object.fromEntries(fields.map((field) => [field.id, field.name])),
    },
  };
}
