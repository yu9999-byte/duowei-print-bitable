import {
  buildAutomationRenderRequest,
  createAutomationFailureResult,
  createAutomationSuccessResult,
  type AutomationActionResult,
  type AutomationOutputType,
  type AutomationRenderRequest,
} from "./automation-domain.ts";
import {
  validateRenderedArtifact,
  type RenderedArtifact,
} from "./automation-artifact.ts";
import type {
  RegisteredAutomationTemplate,
  TemplateRegistryScope,
  TemplateSelection,
} from "./template-registry.ts";

export type AutomationActionExecution = {
  context: {
    tenantKey: string;
    baseToken: string;
    tableId: string;
    recordId: string | null;
    tenantAccessToken: string;
  };
  templateSelection: TemplateSelection;
  outputType: AutomationOutputType;
};

export type RecordReadRequest = {
  baseToken: string;
  tableId: string;
  recordId: string;
  fieldIds: readonly string[];
  tenantAccessToken: string;
};

export type AttachmentUploadRequest = RenderedArtifact & {
  tenantAccessToken: string;
};

export type AutomationActionDependencies = {
  templateRegistry: {
    getTemplate(
      scope: TemplateRegistryScope,
      selection: TemplateSelection,
    ): Promise<RegisteredAutomationTemplate | null>;
  };
  recordReader: {
    readRecord(request: RecordReadRequest): Promise<Readonly<Record<string, unknown>>>;
  };
  renderer: {
    render(request: AutomationRenderRequest): Promise<RenderedArtifact>;
  };
  attachmentUploader: {
    upload(request: AttachmentUploadRequest): Promise<readonly unknown[]>;
  };
};

export type AutomationAction = {
  execute(execution: AutomationActionExecution): Promise<AutomationActionResult>;
};

function requireValue(label: string, value: string | null): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label}不能为空`);
  return normalized;
}

function assertTemplate(
  execution: AutomationActionExecution,
  candidate: RegisteredAutomationTemplate | null,
): asserts candidate is RegisteredAutomationTemplate {
  if (!candidate) throw new Error("所选模板不存在或已删除，请重新选择模板");
  if (candidate.status !== "ready") throw new Error("所选模板尚未同步完成，请稍后重试");
  if (
    candidate.tenantKey !== execution.context.tenantKey
    || candidate.baseToken !== execution.context.baseToken
    || candidate.tableId !== execution.context.tableId
  ) {
    throw new Error("所选模板不属于当前租户、多维表格或数据表");
  }
  if (
    candidate.id !== execution.templateSelection.id
    || candidate.revision !== execution.templateSelection.revision
  ) {
    throw new Error("所选模板已更新，请重新选择最新模板");
  }
}

export function createAutomationAction(
  dependencies: AutomationActionDependencies,
): AutomationAction {
  const completedOrPending = new Map<string, Promise<AutomationActionResult>>();

  return {
    async execute(execution) {
      const scope = {
        tenantKey: requireValue("租户", execution.context.tenantKey),
        baseToken: requireValue("多维表格", execution.context.baseToken),
        tableId: requireValue("数据表", execution.context.tableId),
      };
      const recordId = requireValue("当前记录", execution.context.recordId);
      const tenantAccessToken = requireValue("飞书访问凭据", execution.context.tenantAccessToken);
      const candidate = await dependencies.templateRegistry.getTemplate(
        scope,
        execution.templateSelection,
      );
      assertTemplate(execution, candidate);

      const domainInput = {
        context: { ...scope, recordId },
        template: {
          id: candidate.id,
          name: candidate.name,
          revision: candidate.revision,
          baseToken: candidate.baseToken,
          tableId: candidate.tableId,
          snapshot: candidate.snapshot,
        },
        outputType: execution.outputType,
        referencedFieldIds: candidate.referencedFieldIds,
      } as const;

      // Validate context, scope, template safety and field references before reading record data.
      await buildAutomationRenderRequest({ ...domainInput, recordValues: {} });
      let artifactKey = "";
      try {
        const recordValues = await dependencies.recordReader.readRecord({
          baseToken: scope.baseToken,
          tableId: scope.tableId,
          recordId,
          fieldIds: [...candidate.referencedFieldIds],
          tenantAccessToken,
        });
        const renderRequest = await buildAutomationRenderRequest({ ...domainInput, recordValues });
        artifactKey = renderRequest.artifactKey;

        const existing = completedOrPending.get(artifactKey);
        if (existing) return await existing;

        const pending = (async () => {
          const rendered = await dependencies.renderer.render(renderRequest);
          const artifact = validateRenderedArtifact(artifactKey, execution.outputType, rendered);
          const attachments = await dependencies.attachmentUploader.upload({
            ...artifact,
            tenantAccessToken,
          });
          if (!Array.isArray(attachments) || attachments.length === 0) {
            throw new Error("文件已生成，但飞书附件上传没有返回有效附件");
          }
          return createAutomationSuccessResult(artifactKey, attachments);
        })();
        completedOrPending.set(artifactKey, pending);
        pending.catch(() => {
          if (completedOrPending.get(artifactKey) === pending) completedOrPending.delete(artifactKey);
        });
        return await pending;
      } catch (error) {
        return createAutomationFailureResult(artifactKey, error);
      }
    },
  };
}
