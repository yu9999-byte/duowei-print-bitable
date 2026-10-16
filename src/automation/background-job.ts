import {
  buildAutomationRenderRequest,
  type AutomationJobInput,
  type AutomationOutputType,
  type AutomationRenderRequest,
} from "./automation-domain.ts";
import {
  validateRenderedArtifact,
  type RenderedArtifact,
} from "./automation-artifact.ts";
import { sha256Hex as portableSha256Hex } from "./portable-crypto.ts";

export type BackgroundFieldTargets = {
  attachmentFieldId: string;
  statusFieldId: string;
  errorFieldId?: string;
};

export type BackgroundJobSubmission = {
  version: 1;
  taskKey: string;
  tenantKey: string;
  baseToken: string;
  tableId: string;
  recordId: string;
  outputType: AutomationOutputType;
  renderRequest: AutomationRenderRequest;
  targets: BackgroundFieldTargets;
};

export type BackgroundJobStatus = "queued" | "processing" | "succeeded" | "failed";

export type BackgroundJob = {
  jobId: string;
  taskKey: string;
  status: BackgroundJobStatus;
  attempt: number;
  createdAt: number;
  updatedAt: number;
  submission: BackgroundJobSubmission;
  fileToken?: string;
  error?: string;
};

export type BackgroundJobStore = {
  createOrGet(submission: BackgroundJobSubmission): Promise<BackgroundJob>;
  get(jobId: string): Promise<BackgroundJob | null>;
  save(job: BackgroundJob): Promise<void>;
  listRecoverable(): Promise<BackgroundJob[]>;
};

export type PreparedBackgroundTargets = {
  attachmentFieldName: string;
  statusFieldName: string;
  errorFieldName?: string;
};

export type BackgroundJobPorts = {
  prepareTargets(job: BackgroundJob): Promise<PreparedBackgroundTargets>;
  updateRecord(
    job: BackgroundJob,
    targets: PreparedBackgroundTargets,
    values: Readonly<Record<string, unknown>>,
  ): Promise<void>;
  render(request: AutomationRenderRequest): Promise<RenderedArtifact>;
  uploadArtifact(job: BackgroundJob, artifact: RenderedArtifact): Promise<string>;
};

function requiredString(label: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}不能为空`);
  return value.trim();
}

export function canonicalAutomationJson(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== "object") throw new Error("后台任务包含不可序列化数据");
  if (seen.has(value)) throw new Error("后台任务包含循环引用");
  seen.add(value);
  const result = Array.isArray(value)
    ? `[${value.map((item) => canonicalAutomationJson(item, seen)).join(",")}]`
    : `{${Object.keys(value as Record<string, unknown>).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalAutomationJson((value as Record<string, unknown>)[key], seen)}`
    )).join(",")}}`;
  seen.delete(value);
  return result;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(canonicalAutomationJson(value)) as T;
}

async function sha256Hex(value: string): Promise<string> {
  return portableSha256Hex(value);
}

function normalizeTargets(value: BackgroundFieldTargets): BackgroundFieldTargets {
  const attachmentFieldId = requiredString("附件字段", value.attachmentFieldId);
  const statusFieldId = requiredString("状态字段", value.statusFieldId);
  const errorFieldId = value.errorFieldId?.trim();
  const ids = [attachmentFieldId, statusFieldId, ...(errorFieldId ? [errorFieldId] : [])];
  if (new Set(ids).size !== ids.length) throw new Error("后台模式的附件、状态和错误字段不能重复");
  return {
    attachmentFieldId,
    statusFieldId,
    ...(errorFieldId ? { errorFieldId } : {}),
  };
}

export async function buildBackgroundJobSubmission(
  input: AutomationJobInput & { targets: BackgroundFieldTargets },
): Promise<BackgroundJobSubmission> {
  const renderRequest = await buildAutomationRenderRequest(input);
  const tenantKey = requiredString("租户", input.context.tenantKey);
  const baseToken = requiredString("多维表格", input.context.baseToken);
  const tableId = requiredString("数据表", input.context.tableId);
  const recordId = requiredString("当前记录", input.context.recordId);
  const targets = normalizeTargets(input.targets);
  const taskDigest = await sha256Hex(canonicalAutomationJson({
    version: 1,
    artifactKey: renderRequest.artifactKey,
    tenantKey,
    baseToken,
    tableId,
    recordId,
    targets,
  }));
  return cloneJson({
    version: 1,
    taskKey: `duowei-job:v1:${taskDigest}`,
    tenantKey,
    baseToken,
    tableId,
    recordId,
    outputType: input.outputType,
    renderRequest,
    targets,
  });
}

export function normalizeBackgroundJobSubmission(value: unknown): BackgroundJobSubmission {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("后台任务请求必须是对象");
  }
  const item = value as Record<string, unknown>;
  const expected = new Set([
    "version", "taskKey", "tenantKey", "baseToken", "tableId", "recordId",
    "outputType", "renderRequest", "targets",
  ]);
  if (Object.keys(item).some((key) => !expected.has(key))) {
    throw new Error("后台任务请求包含不支持的属性");
  }
  if (item.version !== 1) throw new Error("后台任务版本无效");
  const taskKey = requiredString("后台任务键", item.taskKey);
  if (!/^duowei-job:v1:[0-9a-f]{64}$/.test(taskKey)) throw new Error("后台任务键格式无效");
  const outputType = item.outputType;
  if (outputType !== "pdf" && outputType !== "png") throw new Error("后台任务输出格式无效");
  const targets = normalizeTargets(item.targets as BackgroundFieldTargets);
  const renderRequest = cloneJson(item.renderRequest) as AutomationRenderRequest;
  if (renderRequest.output?.type !== outputType) throw new Error("后台任务输出格式与渲染请求不一致");
  if (!renderRequest.artifactKey?.startsWith("duowei:v1:")) throw new Error("后台任务产物键无效");
  return cloneJson({
    version: 1,
    taskKey,
    tenantKey: requiredString("租户", item.tenantKey),
    baseToken: requiredString("多维表格", item.baseToken),
    tableId: requiredString("数据表", item.tableId),
    recordId: requiredString("当前记录", item.recordId),
    outputType,
    renderRequest,
    targets,
  });
}

function cloneJob(job: BackgroundJob): BackgroundJob {
  return cloneJson(job);
}

export function createInMemoryBackgroundJobStore(
  options: { now?: () => number } = {},
): BackgroundJobStore {
  const now = options.now ?? Date.now;
  const jobs = new Map<string, BackgroundJob>();
  return {
    async createOrGet(untrusted) {
      const submission = normalizeBackgroundJobSubmission(untrusted);
      const existing = jobs.get(submission.taskKey);
      if (existing) {
        if (existing.status === "failed") {
          existing.status = "queued";
          existing.updatedAt = now();
          delete existing.error;
        }
        return cloneJob(existing);
      }
      const timestamp = now();
      const job: BackgroundJob = {
        jobId: submission.taskKey,
        taskKey: submission.taskKey,
        status: "queued",
        attempt: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
        submission,
      };
      jobs.set(job.jobId, job);
      return cloneJob(job);
    },
    async get(jobId) {
      const job = jobs.get(jobId);
      return job ? cloneJob(job) : null;
    },
    async save(job) {
      if (job.jobId !== job.taskKey || job.jobId !== job.submission.taskKey) {
        throw new Error("后台任务标识不一致");
      }
      jobs.set(job.jobId, cloneJob(job));
    },
    async listRecoverable() {
      return [...jobs.values()]
        .filter((job) => job.status === "queued" || job.status === "processing")
        .sort((left, right) => left.createdAt - right.createdAt)
        .map(cloneJob);
    },
  };
}

function statusValues(
  targets: PreparedBackgroundTargets,
  status: "等待生成" | "生成中" | "生成成功" | "生成失败",
  error = "",
): Record<string, unknown> {
  return {
    [targets.statusFieldName]: status,
    ...(targets.errorFieldName ? { [targets.errorFieldName]: error } : {}),
  };
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [已隐藏]")
    .replace(/((?:tenant|user)[_-]?access[_-]?token\s*[=:]\s*)[^\s,;]+/gi, "$1[已隐藏]")
    .slice(0, 500)
    .trim() || "生成失败，请重试";
}

export function createBackgroundJobProcessor(options: {
  store: BackgroundJobStore;
  ports: BackgroundJobPorts;
  now?: () => number;
}): { process(jobId: string): Promise<BackgroundJob | null> } {
  const now = options.now ?? Date.now;
  const running = new Map<string, Promise<BackgroundJob | null>>();
  return {
    async process(jobId) {
      const existingRun = running.get(jobId);
      if (existingRun) return existingRun;
      const operation = (async () => {
        let job = await options.store.get(jobId);
        if (!job || job.status === "succeeded") return job;
        let targets: PreparedBackgroundTargets | undefined;
        try {
          targets = await options.ports.prepareTargets(job);
          if (job.status === "queued") {
            await options.ports.updateRecord(job, targets, statusValues(targets, "等待生成"));
          }
          job = {
            ...job,
            status: "processing",
            attempt: job.attempt + 1,
            updatedAt: now(),
          };
          delete job.error;
          await options.store.save(job);
          await options.ports.updateRecord(job, targets, statusValues(targets, "生成中"));
          const rendered = await options.ports.render(job.submission.renderRequest);
          const artifact = validateRenderedArtifact(
            job.submission.renderRequest.artifactKey,
            job.submission.outputType,
            rendered,
          );
          const fileToken = requiredString(
            "飞书附件 token",
            await options.ports.uploadArtifact(job, artifact),
          );
          await options.ports.updateRecord(job, targets, {
            [targets.attachmentFieldName]: [{ file_token: fileToken }],
            ...statusValues(targets, "生成成功"),
          });
          job = { ...job, status: "succeeded", fileToken, updatedAt: now() };
          await options.store.save(job);
          return job;
        } catch (error) {
          const message = safeError(error);
          if (targets) {
            try {
              await options.ports.updateRecord(job, targets, statusValues(targets, "生成失败", message));
            } catch {
              // Preserve the primary failure while the persisted job remains retryable.
            }
          }
          job = { ...job, status: "failed", error: message, updatedAt: now() };
          await options.store.save(job);
          return job;
        }
      })();
      running.set(jobId, operation);
      try {
        return await operation;
      } finally {
        if (running.get(jobId) === operation) running.delete(jobId);
      }
    },
  };
}
