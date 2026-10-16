import { sha256Hex as portableSha256Hex } from "./portable-crypto.ts";

export type AutomationOutputType = "pdf" | "png";

export type AutomationTriggerContext = {
  tenantKey: string;
  baseToken: string;
  tableId: string;
  recordId: string | null;
};

export type AutomationTemplate = {
  id: string;
  name: string;
  revision: string;
  baseToken: string;
  tableId: string;
  snapshot: unknown;
};

export type AutomationJobInput = {
  context: AutomationTriggerContext;
  template: AutomationTemplate;
  outputType: AutomationOutputType;
  referencedFieldIds: readonly string[];
  recordValues: Readonly<Record<string, unknown>>;
};

export type AutomationRenderRequest = {
  artifactKey: string;
  template: {
    id: string;
    revision: string;
    snapshot: unknown;
  };
  values: Record<string, unknown>;
  output: {
    type: AutomationOutputType;
    pageLimit: 1 | null;
  };
};

export type AutomationActionResult = {
  success: boolean;
  status: "生成成功" | "生成失败";
  error: string;
  artifactKey: string;
  attachments: unknown[];
};

const SENSITIVE_KEYS = new Set([
  "authorization",
  "appsecret",
  "clientsecret",
  "password",
  "refreshtoken",
  "tenantaccesstoken",
  "useraccesstoken",
]);

const RUNTIME_KEYS = new Set([
  "documents",
  "recorddata",
  "recordid",
  "recordids",
  "records",
  "recordvalues",
  "runtimevalues",
  "testdata",
  "variables",
]);

function requireId(label: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label}不能为空`);
  return normalized;
}

function normalizedKey(key: string): string {
  return key.replace(/[-_]/g, "").toLowerCase();
}

function assertSafeTemplate(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("自动化模板包含不可序列化数值");
    return;
  }
  if (typeof value !== "object") throw new Error("自动化模板包含不可序列化数据");
  if (seen.has(value)) throw new Error("自动化模板包含循环引用");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertSafeTemplate(item, seen);
  } else {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const normalized = normalizedKey(key);
      if (SENSITIVE_KEYS.has(normalized) || normalized.endsWith("accesstoken")) {
        throw new Error(`自动化模板包含敏感凭据：${key}`);
      }
      if (RUNTIME_KEYS.has(normalized)) {
        throw new Error(`自动化模板包含不允许同步的运行数据：${key}`);
      }
      assertSafeTemplate(item, seen);
    }
  }
  seen.delete(value);
}

function canonicalJson(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("自动化任务包含不可序列化数值");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new Error("自动化任务包含不可序列化数据");
  if (seen.has(value)) throw new Error("自动化任务包含循环引用");
  seen.add(value);
  let result: string;
  if (Array.isArray(value)) {
    result = `[${value.map((item) => canonicalJson(item, seen)).join(",")}]`;
  } else {
    result = `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key], seen)}`)
      .join(",")}}`;
  }
  seen.delete(value);
  return result;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

export function sanitizeAutomationTemplateSnapshot<T>(snapshot: T): T {
  assertSafeTemplate(snapshot);
  return cloneJson(snapshot);
}

async function sha256Hex(value: string): Promise<string> {
  return portableSha256Hex(value);
}

function referencedValues(
  fieldIds: readonly string[],
  recordValues: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const unique = new Set<string>();
  for (const rawId of fieldIds) {
    const fieldId = requireId("引用字段 ID", rawId);
    if (unique.has(fieldId)) throw new Error(`自动化模板包含重复字段引用：${fieldId}`);
    unique.add(fieldId);
    if (Object.prototype.hasOwnProperty.call(recordValues, fieldId)) {
      values[fieldId] = cloneJson(recordValues[fieldId]);
    }
  }
  return values;
}

export async function buildAutomationRenderRequest(
  input: AutomationJobInput,
): Promise<AutomationRenderRequest> {
  const tenantKey = requireId("租户", input.context.tenantKey);
  const baseToken = requireId("多维表格", input.context.baseToken);
  const tableId = requireId("数据表", input.context.tableId);
  const recordId = input.context.recordId?.trim();
  if (!recordId) throw new Error("当前自动化触发没有当前记录，首期仅支持单条记录触发");

  const templateId = requireId("模板 ID", input.template.id);
  const revision = requireId("模板修订", input.template.revision);
  if (input.template.baseToken !== baseToken || input.template.tableId !== tableId) {
    throw new Error("所选模板不属于当前多维表格的当前数据表");
  }
  if (input.outputType !== "pdf" && input.outputType !== "png") {
    throw new Error("自动化输出类型无效");
  }

  const snapshot = sanitizeAutomationTemplateSnapshot(input.template.snapshot);
  const values = referencedValues(input.referencedFieldIds, input.recordValues);
  const keyMaterial = canonicalJson({
    version: 1,
    tenantKey,
    baseToken,
    tableId,
    recordId,
    templateId,
    revision,
    outputType: input.outputType,
    values,
  });
  const artifactKey = `duowei:v1:${await sha256Hex(keyMaterial)}`;

  return {
    artifactKey,
    template: { id: templateId, revision, snapshot },
    values,
    output: {
      type: input.outputType,
      pageLimit: input.outputType === "png" ? 1 : null,
    },
  };
}

export function createAutomationSuccessResult(
  artifactKey: string,
  attachments: readonly unknown[],
): AutomationActionResult {
  return {
    success: true,
    status: "生成成功",
    error: "",
    artifactKey,
    attachments: [...attachments],
  };
}

function redactError(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [已隐藏]")
    .replace(/((?:tenant|user)[_-]?access[_-]?token\s*[=:]\s*)[^\s,;]+/gi, "$1[已隐藏]")
    .slice(0, 500)
    .trim();
}

export function createAutomationFailureResult(
  artifactKey: string,
  error: unknown,
): AutomationActionResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    success: false,
    status: "生成失败",
    error: redactError(message) || "生成失败，请重试",
    artifactKey,
    attachments: [],
  };
}
