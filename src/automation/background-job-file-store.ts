import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import {
  canonicalAutomationJson,
  createInMemoryBackgroundJobStore,
  normalizeBackgroundJobSubmission,
  type BackgroundJob,
  type BackgroundJobStatus,
  type BackgroundJobStore,
} from "./background-job.ts";

type PersistentBackgroundState = { version: 1; jobs: BackgroundJob[] };

function validStatus(value: unknown): value is BackgroundJobStatus {
  return value === "queued" || value === "processing" || value === "succeeded" || value === "failed";
}

function normalizeJob(value: unknown): BackgroundJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("后台任务持久化数据无效");
  const item = value as Record<string, unknown>;
  const expected = new Set([
    "jobId", "taskKey", "status", "attempt", "createdAt", "updatedAt",
    "submission", "fileToken", "error",
  ]);
  if (Object.keys(item).some((key) => !expected.has(key))) throw new Error("后台任务持久化数据包含未知属性");
  const submission = normalizeBackgroundJobSubmission(item.submission);
  if (item.jobId !== submission.taskKey || item.taskKey !== submission.taskKey) {
    throw new Error("后台任务持久化标识不一致");
  }
  if (!validStatus(item.status)) throw new Error("后台任务持久化状态无效");
  if (!Number.isSafeInteger(item.attempt) || Number(item.attempt) < 0) throw new Error("后台任务尝试次数无效");
  if (!Number.isFinite(item.createdAt) || !Number.isFinite(item.updatedAt)) throw new Error("后台任务时间无效");
  return JSON.parse(canonicalAutomationJson({
    jobId: item.jobId,
    taskKey: item.taskKey,
    status: item.status,
    attempt: item.attempt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    submission,
    ...(typeof item.fileToken === "string" ? { fileToken: item.fileToken } : {}),
    ...(typeof item.error === "string" ? { error: item.error } : {}),
  })) as BackgroundJob;
}

export function createJsonFileBackgroundJobStore(options: { path: string; now?: () => number }): BackgroundJobStore {
  if (!isAbsolute(options.path)) throw new Error("后台任务持久化路径必须是绝对路径");
  const memory = createInMemoryBackgroundJobStore({ now: options.now });
  let loaded = false;
  let writeQueue = Promise.resolve();

  const load = async () => {
    if (loaded) return;
    loaded = true;
    let raw: string;
    try {
      raw = await readFile(options.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error("后台任务持久化文件已损坏");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("后台任务持久化文件无效");
    const state = value as Record<string, unknown>;
    if (state.version !== 1 || !Array.isArray(state.jobs)) throw new Error("后台任务持久化版本无效");
    for (const job of state.jobs.map(normalizeJob)) await memory.save(job);
  };

  const persist = async () => {
    const all: BackgroundJob[] = [];
    const recoverable = await memory.listRecoverable();
    const ids = new Set(recoverable.map((job) => job.jobId));
    all.push(...recoverable);
    let persisted: PersistentBackgroundState | undefined;
    try {
      const raw = await readFile(options.path, "utf8");
      persisted = JSON.parse(raw) as PersistentBackgroundState;
    } catch {
      // First write or a file that has already failed closed during load.
    }
    for (const candidate of persisted?.jobs ?? []) {
      if (ids.has(candidate.jobId)) continue;
      const current = await memory.get(candidate.jobId);
      if (current) {
        all.push(current);
        ids.add(current.jobId);
      }
    }
    const state: PersistentBackgroundState = { version: 1, jobs: all };
    await mkdir(dirname(options.path), { recursive: true });
    const temporary = `${options.path}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, `${canonicalAutomationJson(state)}\n`, { encoding: "utf8", flag: "wx" });
    try {
      await rename(temporary, options.path);
    } finally {
      await rm(temporary, { force: true });
    }
  };

  const enqueuePersist = async () => {
    writeQueue = writeQueue.then(persist);
    await writeQueue;
  };

  return {
    async createOrGet(submission) {
      await load();
      const job = await memory.createOrGet(submission);
      await enqueuePersist();
      return job;
    },
    async get(jobId) { await load(); return memory.get(jobId); },
    async save(job) { await load(); await memory.save(job); await enqueuePersist(); },
    async listRecoverable() { await load(); return memory.listRecoverable(); },
  };
}
