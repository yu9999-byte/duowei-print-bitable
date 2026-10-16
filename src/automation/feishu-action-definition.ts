import {
  Component,
  NextStep,
  ParamType,
  StructureType,
  type Action,
  type Context,
} from "@lark-opdev/block-basekit-server-api";
import {
  createAutomationAction,
  type RecordReadRequest,
} from "./automation-action.ts";
import type { AutomationRenderRequest } from "./automation-domain.ts";
import type { RenderedArtifact } from "./automation-artifact.ts";
import {
  buildBackgroundJobSubmission,
  type BackgroundJobSubmission,
} from "./background-job.ts";
import {
  decodeTemplateSelection,
  listTemplateOptions,
  type RegisteredAutomationTemplate,
  type TemplateRegistryScope,
  type TemplateSelection,
} from "./template-registry.ts";

export type FeishuAutomationAdapters = {
  templates: {
    list(context: Context, scope: TemplateRegistryScope): Promise<readonly RegisteredAutomationTemplate[]>;
    get(
      context: Context,
      scope: TemplateRegistryScope,
      selection: TemplateSelection,
    ): Promise<RegisteredAutomationTemplate | null>;
  };
  recordReader: {
    readRecord(
      context: Context,
      request: Omit<RecordReadRequest, "tenantAccessToken">,
    ): Promise<Readonly<Record<string, unknown>>>;
  };
  renderer: {
    render(context: Context, request: AutomationRenderRequest): Promise<RenderedArtifact>;
  };
  attachmentUploader: {
    upload(context: Context, artifact: RenderedArtifact): Promise<readonly unknown[]>;
  };
  fields: {
    list(
      context: Context,
      scope: TemplateRegistryScope,
    ): Promise<readonly AutomationTableField[]>;
  };
  backgroundJobs: {
    submit(
      context: Context,
      request: BackgroundJobSubmission,
    ): Promise<{ jobId: string; status: string; reused: boolean }>;
  };
};

export type AutomationTableField = {
  id: string;
  name: string;
  type: "attachment" | "text" | "other";
};

const TEMPLATE_READ_ERROR_VALUE = "__duowei_template_read_error__";

function safeAutocompleteError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [已隐藏]")
    .replace(/((?:tenant|user)[_-]?access[_-]?token\s*[=:]\s*)[^\s,;]+/gi, "$1[已隐藏]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "未知错误";
}

function currentScope(context: Context): TemplateRegistryScope {
  return {
    tenantKey: context.tenantKey,
    baseToken: context.app.token,
    tableId: context.app.trigger.tableID ?? "",
  };
}

function requireOutputType(value: unknown): "pdf" | "png" {
  if (value === "pdf" || value === "png") return value;
  throw new Error("请选择 PDF 或 PNG 输出格式");
}

function requireRunMode(value: unknown): "standard" | "background" {
  if (value === undefined || value === "standard") return "standard";
  if (value === "background") return "background";
  throw new Error("请选择标准模式或后台模式");
}

function requireString(label: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}不能为空`);
  return value.trim();
}

function assertCurrentTemplate(
  scope: TemplateRegistryScope,
  selection: TemplateSelection,
  template: RegisteredAutomationTemplate | null,
): asserts template is RegisteredAutomationTemplate {
  if (!template || template.status !== "ready") throw new Error("所选模板不存在、已删除或尚未同步完成");
  if (template.tenantKey !== scope.tenantKey || template.baseToken !== scope.baseToken || template.tableId !== scope.tableId) {
    throw new Error("所选模板不属于当前租户、多维表格或数据表");
  }
  if (template.id !== selection.id || template.revision !== selection.revision) {
    throw new Error("所选模板已更新，请重新选择最新模板");
  }
}

function fieldAutocomplete(
  adapters: FeishuAutomationAdapters,
  type: AutomationTableField["type"],
) {
  return async (_args: Record<string, unknown>, context: Context, payload: {
    keyword: string;
    lang: "zh-CN" | "en-US" | "ja-JP" | "zh-HK" | "zh-TW";
  }) => {
    const scope = currentScope(context);
    const fields = await adapters.fields.list(context, scope);
    const keyword = payload.keyword.trim().toLocaleLowerCase(payload.lang);
    return {
      options: fields
        .filter((field) => field.type === type)
        .filter((field) => !keyword || field.name.toLocaleLowerCase(payload.lang).includes(keyword))
        .map((field) => ({ value: field.id, label: field.name })),
      isPaginated: false,
      isLastPage: true,
    };
  };
}

export function createFeishuAutomationActionDefinition(
  adapters: FeishuAutomationAdapters,
): Action {
  return {
    description: "使用多维打印中已保存的模板，为当前触发记录生成 PDF 或 PNG 文件。",
    actionText: "生成打印文件",
    permission: { type: 2 },
    useTenantAccessToken: true,
    formItems: [
      {
        itemId: "template",
        label: "打印模板",
        required: true,
        paramType: ParamType.String,
        component: Component.SingleSelect,
        componentProps: {
          placeholder: "选择当前数据表的已保存模板",
          options: [],
        },
        async autocomplete(_args, context, payload) {
          try {
            const scope = currentScope(context);
            const templates = await adapters.templates.list(context, scope);
            const keyword = payload.keyword.trim().toLocaleLowerCase(payload.lang);
            const options = listTemplateOptions(scope, templates).filter((option) => (
              !keyword || option.label.toLocaleLowerCase(payload.lang).includes(keyword)
            ));
            return { options, isPaginated: false, isLastPage: true };
          } catch (error) {
            return {
              options: [{
                value: TEMPLATE_READ_ERROR_VALUE,
                label: `模板读取失败：${safeAutocompleteError(error)}`,
              }],
              isPaginated: false,
              isLastPage: true,
            };
          }
        },
      },
      {
        itemId: "outputType",
        label: "输出格式",
        required: true,
        paramType: ParamType.String,
        component: Component.Radio,
        componentProps: {
          defaultValue: "pdf",
          options: [
            { value: "pdf", label: "PDF（完整多页）" },
            { value: "png", label: "PNG（仅第一页）" },
          ],
        },
      },
      {
        itemId: "runMode",
        label: "运行模式",
        required: true,
        paramType: ParamType.String,
        component: Component.Radio,
        componentProps: {
          defaultValue: "standard",
          options: [
            { value: "standard", label: "标准模式" },
            { value: "background", label: "后台模式" },
          ],
        },
      },
      {
        itemId: "attachmentField",
        label: "附件字段",
        required: true,
        paramType: ParamType.String,
        component: Component.SingleSelect,
        displayBy: "runMode:background",
        componentProps: { placeholder: "选择写入 PDF 或图片的附件字段", options: [] },
        autocomplete: fieldAutocomplete(adapters, "attachment"),
      },
      {
        itemId: "statusField",
        label: "状态字段",
        required: true,
        paramType: ParamType.String,
        component: Component.SingleSelect,
        displayBy: "runMode:background",
        componentProps: { placeholder: "选择写入生成状态的文本字段", options: [] },
        autocomplete: fieldAutocomplete(adapters, "text"),
      },
      {
        itemId: "errorField",
        label: "错误字段（可选）",
        required: false,
        paramType: ParamType.String,
        component: Component.SingleSelect,
        displayBy: "runMode:background",
        componentProps: { placeholder: "选择写入失败原因的文本字段", options: [] },
        autocomplete: fieldAutocomplete(adapters, "text"),
      },
      {
        itemId: "outputHelp",
        component: Component.Tips,
        componentProps: {
          message: "PDF 会生成模板的全部页面；PNG 仅生成第一页。标准模式把文件交给后续步骤，后台模式直接写入当前记录。",
        },
      },
    ],
    resultType: {
      type: "object",
      properties: {
        attachments: {
          type: "array",
          label: "生成文件",
          structureType: StructureType.Attachment,
        },
        success: { type: "boolean", label: "是否成功" },
        status: { type: "string", label: "生成状态" },
        error: { type: "string", label: "错误信息" },
        artifactKey: { type: "string", label: "产物标识" },
      },
    },
    nextSteps: [NextStep.SetRecord],
    async execute(args, context) {
      if (typeof args.template !== "string") throw new Error("请选择打印模板");
      if (args.template === TEMPLATE_READ_ERROR_VALUE) throw new Error("模板读取失败，请重新打开模板列表后重试");
      const templateSelection = decodeTemplateSelection(args.template);
      const scope = currentScope(context);
      const outputType = requireOutputType(args.outputType);
      const runMode = requireRunMode(args.runMode);
      if (runMode === "background") {
        const recordId = requireString("当前记录", context.app.trigger.recordID);
        const candidate = await adapters.templates.get(context, scope, templateSelection);
        assertCurrentTemplate(scope, templateSelection, candidate);
        const fields = await adapters.fields.list(context, scope);
        const byId = new Map(fields.map((field) => [field.id, field]));
        const attachmentFieldId = requireString("附件字段", args.attachmentField);
        const statusFieldId = requireString("状态字段", args.statusField);
        const errorFieldId = typeof args.errorField === "string" && args.errorField.trim()
          ? args.errorField.trim()
          : undefined;
        if (byId.get(attachmentFieldId)?.type !== "attachment") throw new Error("请选择当前表的附件字段");
        if (byId.get(statusFieldId)?.type !== "text") throw new Error("请选择当前表的文本状态字段");
        if (errorFieldId && byId.get(errorFieldId)?.type !== "text") throw new Error("请选择当前表的文本错误字段");
        const recordValues = await adapters.recordReader.readRecord(context, {
          baseToken: scope.baseToken,
          tableId: scope.tableId,
          recordId,
          fieldIds: [...candidate.referencedFieldIds],
        });
        const submission = await buildBackgroundJobSubmission({
          context: { ...scope, recordId },
          template: {
            id: candidate.id,
            name: candidate.name,
            revision: candidate.revision,
            baseToken: candidate.baseToken,
            tableId: candidate.tableId,
            snapshot: candidate.snapshot,
          },
          outputType,
          referencedFieldIds: candidate.referencedFieldIds,
          recordValues,
          targets: { attachmentFieldId, statusFieldId, ...(errorFieldId ? { errorFieldId } : {}) },
        });
        const accepted = await adapters.backgroundJobs.submit(context, submission);
        if (!accepted.jobId) throw new Error("后台任务没有返回任务标识");
        return {
          success: true,
          status: accepted.status === "succeeded" ? "生成成功" : "等待生成",
          error: "",
          artifactKey: submission.renderRequest.artifactKey,
          attachments: [],
        };
      }
      const action = createAutomationAction({
        templateRegistry: {
          getTemplate(_requestedScope, selection) {
            return adapters.templates.get(context, scope, selection);
          },
        },
        recordReader: {
          readRecord(request) {
            const { tenantAccessToken: _token, ...safeRequest } = request;
            return adapters.recordReader.readRecord(context, safeRequest);
          },
        },
        renderer: {
          render(request) {
            return adapters.renderer.render(context, request);
          },
        },
        attachmentUploader: {
          upload(request) {
            const { tenantAccessToken: _token, ...artifact } = request;
            return adapters.attachmentUploader.upload(context, artifact);
          },
        },
      });
      return action.execute({
        context: {
          ...scope,
          recordId: context.app.trigger.recordID ?? null,
          tenantAccessToken: context.tenantAccessToken,
        },
        templateSelection,
        outputType,
      });
    },
  };
}
