import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildBackgroundJobSubmission,
  createBackgroundJobProcessor,
  createInMemoryBackgroundJobStore,
} from "../src/automation/background-job.ts";
import {
  createBackgroundJobHttpClient,
  createBackgroundJobHttpHandler,
} from "../src/automation/background-job-service.ts";
import { createJsonFileBackgroundJobStore } from "../src/automation/background-job-file-store.ts";

const secret = new TextEncoder().encode("background-job-test-secret-that-is-long-enough");

async function submission() {
  return buildBackgroundJobSubmission({
    context: {
      tenantKey: "tenant-a",
      baseToken: "base-a",
      tableId: "table-a",
      recordId: "record-a",
    },
    template: {
      id: "template-a",
      name: "发货单",
      revision: "revision-a",
      baseToken: "base-a",
      tableId: "table-a",
      snapshot: { pages: [] },
    },
    outputType: "pdf",
    referencedFieldIds: ["field-a"],
    recordValues: { "field-a": "SO-001", ignored: "不得提交" },
    targets: {
      attachmentFieldId: "attachment-a",
      statusFieldId: "status-a",
      errorFieldId: "error-a",
    },
  });
}

test("IT-AUTO-10: signed background submission persists once and never carries access tokens", async () => {
  const store = createInMemoryBackgroundJobStore();
  const handler = createBackgroundJobHttpHandler({ store, signingSecret: secret, now: () => 1_800_000_000_000 });
  const bodies: string[] = [];
  const tenantTokens: string[] = [];
  const client = createBackgroundJobHttpClient({
    endpoint: "https://service.example/v1/background-jobs",
    authorization: "Bearer service-key",
    tenantAccessToken: "tenant-access-token-secret",
    signingSecret: secret,
    now: () => 1_800_000_000_000,
    async fetch(input, init) {
      bodies.push(String(init?.body ?? ""));
      tenantTokens.push(new Headers(init?.headers).get("x-duowei-tenant-access-token") ?? "");
      return handler(new Request(String(input), init));
    },
  });
  const body = await submission();
  const first = await client.submit(body);
  const second = await client.submit(body);

  assert.equal(first.jobId, second.jobId);
  assert.equal(first.status, "queued");
  assert.equal((await store.listRecoverable()).length, 1);
  assert.equal(bodies.some((value) => /tenant.?access.?token|Bearer t-/i.test(value)), false);
  assert.deepEqual(tenantTokens, ["tenant-access-token-secret", "tenant-access-token-secret"]);
  assert.equal(JSON.stringify(body).includes("ignored"), false);
});

test("IT-AUTO-10: processor advances waiting, processing, success and reuses a completed job", async () => {
  const store = createInMemoryBackgroundJobStore();
  const body = await submission();
  const job = await store.createOrGet(body);
  const calls: string[] = [];
  let renderCount = 0;
  const processor = createBackgroundJobProcessor({
    store,
    ports: {
      async prepareTargets() {
        return {
          attachmentFieldName: "生成文件",
          statusFieldName: "生成状态",
          errorFieldName: "错误信息",
        };
      },
      async updateRecord(_job, _targets, values) {
        calls.push(JSON.stringify(values));
      },
      async render(request) {
        renderCount += 1;
        return {
          artifactKey: request.artifactKey,
          fileName: "发货单.pdf",
          contentType: "application/pdf",
          pageCount: 1,
          bytes: new TextEncoder().encode("%PDF-1.4\n%%EOF"),
        };
      },
      async uploadArtifact() { return "file-token-a"; },
    },
    now: () => 1_800_000_000_000,
  });

  await processor.process(job.jobId);
  await processor.process(job.jobId);
  assert.equal(renderCount, 1);
  assert.deepEqual(calls.map((value) => JSON.parse(value)), [
    { "生成状态": "等待生成", "错误信息": "" },
    { "生成状态": "生成中", "错误信息": "" },
    { "生成文件": [{ file_token: "file-token-a" }], "生成状态": "生成成功", "错误信息": "" },
  ]);
  assert.equal((await store.get(job.jobId))?.status, "succeeded");
});

test("IT-AUTO-10: processor writes a safe failure and a duplicate trigger requeues the same task", async () => {
  const store = createInMemoryBackgroundJobStore();
  const body = await submission();
  const job = await store.createOrGet(body);
  const calls: Array<Record<string, unknown>> = [];
  const processor = createBackgroundJobProcessor({
    store,
    ports: {
      async prepareTargets() {
        return {
          attachmentFieldName: "生成文件",
          statusFieldName: "生成状态",
          errorFieldName: "错误信息",
        };
      },
      async updateRecord(_job, _targets, values) { calls.push({ ...values }); },
      async render() { throw new Error("Bearer secret-token renderer unavailable"); },
      async uploadArtifact() { throw new Error("unexpected upload"); },
    },
  });
  await processor.process(job.jobId);
  const failed = await store.get(job.jobId);
  assert.equal(failed?.status, "failed");
  assert.match(failed?.error ?? "", /Bearer \[已隐藏\]/);
  assert.equal(calls.at(-1)?.["生成状态"], "生成失败");
  assert.equal(String(calls.at(-1)?.["错误信息"]).includes("secret-token"), false);

  const retried = await store.createOrGet(body);
  assert.equal(retried.jobId, job.jobId);
  assert.equal(retried.status, "queued");
  assert.equal(retried.error, undefined);
});

test("IT-AUTO-10: JSON store recovers queued jobs after restart and never persists credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "duowei-background-"));
  const path = join(directory, "jobs.json");
  try {
    const first = createJsonFileBackgroundJobStore({ path });
    const created = await first.createOrGet(await submission());
    const second = createJsonFileBackgroundJobStore({ path });
    assert.equal((await second.get(created.jobId))?.status, "queued");
    assert.equal((await second.listRecoverable()).length, 1);
    assert.doesNotMatch(await readFile(path, "utf8"), /app_secret|tenant_access_token|Bearer\s+t-/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
