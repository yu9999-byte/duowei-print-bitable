export type AutomationTemplateStatus = "ready" | "syncing" | "error" | "deleted";

export type RegisteredAutomationTemplate = {
  tenantKey: string;
  baseToken: string;
  tableId: string;
  id: string;
  name: string;
  revision: string;
  status: AutomationTemplateStatus;
  snapshot: unknown;
  referencedFieldIds: readonly string[];
};

export type TemplateRegistryScope = Pick<
  RegisteredAutomationTemplate,
  "tenantKey" | "baseToken" | "tableId"
>;

export type TemplateSelection = Pick<RegisteredAutomationTemplate, "id" | "revision">;

export type TemplateOption = {
  label: string;
  value: string;
};

const SELECTION_PREFIX = "duowei-template:v1:";

function requireNonEmpty(label: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}不能为空`);
  return value;
}

export function encodeTemplateSelection(selection: TemplateSelection): string {
  const payload = JSON.stringify({
    id: requireNonEmpty("模板 ID", selection.id),
    revision: requireNonEmpty("模板修订", selection.revision),
  });
  return `${SELECTION_PREFIX}${encodeURIComponent(payload)}`;
}

export function decodeTemplateSelection(value: string): TemplateSelection {
  try {
    if (!value.startsWith(SELECTION_PREFIX)) throw new Error("prefix");
    const payload = JSON.parse(decodeURIComponent(value.slice(SELECTION_PREFIX.length))) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("shape");
    const record = payload as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.length !== 2 || keys[0] !== "id" || keys[1] !== "revision") throw new Error("keys");
    return {
      id: requireNonEmpty("模板 ID", record.id),
      revision: requireNonEmpty("模板修订", record.revision),
    };
  } catch {
    throw new Error("模板选项无效，请重新选择模板");
  }
}

export function listTemplateOptions(
  scope: TemplateRegistryScope,
  templates: readonly RegisteredAutomationTemplate[],
): TemplateOption[] {
  const tenantKey = requireNonEmpty("租户", scope.tenantKey);
  const baseToken = requireNonEmpty("多维表格", scope.baseToken);
  const tableId = requireNonEmpty("数据表", scope.tableId);

  return templates
    .filter((template) => (
      template.status === "ready"
      && template.tenantKey === tenantKey
      && template.baseToken === baseToken
      && template.tableId === tableId
    ))
    .map((template) => ({
      label: requireNonEmpty("模板名称", template.name),
      value: encodeTemplateSelection(template),
    }));
}
