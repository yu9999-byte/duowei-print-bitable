import {
  uploadAttachments as uploadFeishuAttachments,
  type Context,
} from "@lark-opdev/block-basekit-server-api";
import type { RenderedArtifact } from "./automation-artifact.ts";
import type { FeishuAutomationAdapters } from "./feishu-action-definition.ts";
import { createBackgroundJobHttpClient } from "./background-job-service.ts";
import { createRendererHttpClient } from "./renderer-service.ts";
import { createTemplateRegistryHttpReader } from "./template-registry-service.ts";
import type { TemplateRegistryScope } from "./template-registry.ts";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type UploadInput = {
  name: string;
  mimeType: string;
  file: Uint8Array;
};

type AdapterOptions = {
  serviceAuthorization: string;
  registryEndpoint: string;
  registryReadSigningSecret: Uint8Array;
  rendererEndpoint: string;
  rendererSigningSecret: Uint8Array;
  backgroundJobEndpoint?: string;
  backgroundJobSigningSecret?: Uint8Array;
  now?: () => number;
  env?: string;
  uploadAttachments?: (
    attachments: UploadInput[],
    options: { context: Context; env: string },
  ) => Promise<readonly unknown[]>;
};

function contextFetch(context: Context): FetchLike {
  return async (input, init) => context.fetch(String(input), init as never) as unknown as Promise<Response>;
}

function requireCurrentScope(context: Context, scope: TemplateRegistryScope): void {
  if (!context.tenantKey.trim() || scope.tenantKey !== context.tenantKey
    || scope.baseToken !== context.app.token
    || scope.tableId !== context.app.trigger.tableID) {
    throw new Error("自动化模板请求与当前租户、多维表格或数据表不一致");
  }
}

function openApiUrl(baseToken: string, tableId: string): string {
  return `https://open.feishu.cn/open-apis/base/v3/bases/${encodeURIComponent(baseToken)}`
    + `/tables/${encodeURIComponent(tableId)}/records/batch_get`;
}

function fieldsApiUrl(baseToken: string, tableId: string, pageToken?: string): string {
  const url = new URL(
    `https://open.feishu.cn/open-apis/base/v3/bases/${encodeURIComponent(baseToken)}`
      + `/tables/${encodeURIComponent(tableId)}/fields`,
  );
  url.searchParams.set("page_size", "100");
  if (pageToken) url.searchParams.set("page_token", pageToken);
  return url.toString();
}

function normalizedFieldType(value: unknown): "attachment" | "text" | "other" {
  if (value === "attachment" || value === 17) return "attachment";
  if (value === "text" || value === 1) return "text";
  return "other";
}

function plainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function responseJson(response: Response, label: string): Promise<Record<string, unknown>> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${label}没有返回有效 JSON`);
  }
  const object = plainObject(payload);
  if (!object) throw new Error(`${label}返回格式无效`);
  return object;
}

function safeApiMessage(value: unknown): string {
  const message = typeof value === "string" ? value : "未知错误";
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [已隐藏]")
    .slice(0, 300);
}

function nodeBuffer(bytes: Uint8Array): Uint8Array {
  const factory = (globalThis as unknown as {
    Buffer?: { from(input: Uint8Array): Uint8Array };
  }).Buffer;
  if (!factory) throw new Error("当前自动化运行环境不支持附件 Buffer");
  return factory.from(bytes);
}

export function createFeishuAutomationAdapters(options: AdapterOptions): FeishuAutomationAdapters {
  const upload = options.uploadAttachments ?? (async (attachments, uploadOptions) => (
    uploadFeishuAttachments(attachments as never, uploadOptions as never)
  ));
  const env = options.env ?? "feishu";

  return {
    templates: {
      async list(context, scope) {
        requireCurrentScope(context, scope);
        const reader = createTemplateRegistryHttpReader({
          endpoint: options.registryEndpoint,
          authorization: options.serviceAuthorization,
          signingSecret: options.registryReadSigningSecret,
          now: options.now,
          fetch: contextFetch(context),
        });
        return reader.list(scope);
      },
      async get(context, scope, selection) {
        requireCurrentScope(context, scope);
        const reader = createTemplateRegistryHttpReader({
          endpoint: options.registryEndpoint,
          authorization: options.serviceAuthorization,
          signingSecret: options.registryReadSigningSecret,
          now: options.now,
          fetch: contextFetch(context),
        });
        return reader.get(scope, selection);
      },
    },
    recordReader: {
      async readRecord(context, request) {
        if (request.baseToken !== context.app.token
          || request.tableId !== context.app.trigger.tableID
          || request.recordId !== context.app.trigger.recordID) {
          throw new Error("记录读取请求与当前自动化触发记录不一致");
        }
        const fieldIds = [...new Set(request.fieldIds.map((fieldId) => fieldId.trim()))];
        if (fieldIds.some((fieldId) => !fieldId)) throw new Error("记录读取字段 ID 不能为空");
        if (fieldIds.length === 0) return {};
        const response = await context.fetch(openApiUrl(request.baseToken, request.tableId), {
          method: "POST",
          headers: {
            "authorization": `Bearer ${context.tenantAccessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            record_id_list: [request.recordId],
            select_fields: fieldIds,
          }),
        });
        const payload = await responseJson(response as unknown as Response, "飞书记录接口");
        if (!response.ok || payload.code !== 0) {
          throw new Error(`读取触发记录失败：${safeApiMessage(payload.msg ?? response.statusText)}`);
        }
        const data = plainObject(payload.data);
        const records = data?.records;
        if (!Array.isArray(records) || records.length !== 1) {
          throw new Error("读取触发记录失败：飞书没有返回唯一记录");
        }
        const record = plainObject(records[0]);
        if (record?.record_id !== request.recordId) {
          throw new Error("读取触发记录失败：飞书返回了其他记录");
        }
        const fields = plainObject(record.fields);
        if (!fields) throw new Error("读取触发记录失败：记录字段格式无效");
        return Object.fromEntries(fieldIds
          .filter((fieldId) => Object.prototype.hasOwnProperty.call(fields, fieldId))
          .map((fieldId) => [fieldId, fields[fieldId]]));
      },
    },
    renderer: {
      async render(context, request) {
        const client = createRendererHttpClient({
          endpoint: options.rendererEndpoint,
          authorization: options.serviceAuthorization,
          signingSecret: options.rendererSigningSecret,
          now: options.now,
          fetch: contextFetch(context),
        });
        return client.render(request);
      },
    },
    attachmentUploader: {
      async upload(context, artifact: RenderedArtifact) {
        return upload([{
          name: artifact.fileName,
          mimeType: artifact.contentType,
          file: nodeBuffer(artifact.bytes),
        }], { context, env });
      },
    },
    fields: {
      async list(context, scope) {
        requireCurrentScope(context, scope);
        const fields: Array<{ id: string; name: string; type: "attachment" | "text" | "other" }> = [];
        let pageToken: string | undefined;
        do {
          const response = await context.fetch(fieldsApiUrl(scope.baseToken, scope.tableId, pageToken), {
            headers: { authorization: `Bearer ${context.tenantAccessToken}` },
          });
          const payload = await responseJson(response as unknown as Response, "飞书字段接口");
          if (!response.ok || payload.code !== 0) {
            throw new Error(`读取当前表字段失败：${safeApiMessage(payload.msg ?? response.statusText)}`);
          }
          const data = plainObject(payload.data);
          if (!data || !Array.isArray(data.items)) throw new Error("读取当前表字段失败：字段列表格式无效");
          for (const item of data.items) {
            const field = plainObject(item);
            if (!field) continue;
            const id = typeof field.id === "string" ? field.id : field.field_id;
            const name = typeof field.name === "string" ? field.name : field.field_name;
            if (typeof id !== "string" || !id.trim() || typeof name !== "string" || !name.trim()) continue;
            fields.push({ id: id.trim(), name: name.trim(), type: normalizedFieldType(field.type) });
          }
          pageToken = data.has_more === true && typeof data.page_token === "string" && data.page_token
            ? data.page_token
            : undefined;
        } while (pageToken);
        return fields;
      },
    },
    backgroundJobs: {
      async submit(context, request) {
        if (!options.backgroundJobEndpoint || !options.backgroundJobSigningSecret) {
          throw new Error("后台模式服务尚未配置");
        }
        const client = createBackgroundJobHttpClient({
          endpoint: options.backgroundJobEndpoint,
          authorization: options.serviceAuthorization,
          tenantAccessToken: context.tenantAccessToken,
          signingSecret: options.backgroundJobSigningSecret,
          now: options.now,
          fetch: contextFetch(context),
        });
        return client.submit(request);
      },
    },
  };
}
