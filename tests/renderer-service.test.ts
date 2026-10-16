import assert from "node:assert/strict";
import test from "node:test";
import {
  createRendererHttpClient,
  createRendererHttpHandler,
  signRendererRequest,
} from "../src/automation/renderer-service.ts";
import type { AutomationRenderRequest } from "../src/automation/automation-domain.ts";

const secret = new TextEncoder().encode("renderer-test-secret-that-is-at-least-32-bytes");
const now = 1_800_000_000_000;
const pdfBytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%%EOF");

function renderRequest(overrides: Partial<AutomationRenderRequest> = {}): AutomationRenderRequest {
  return {
    artifactKey: "duowei:v1:artifact-a",
    template: {
      id: "template-a",
      revision: "revision-a",
      snapshot: { canvasSize: { width: 600, height: 800 }, pages: [] },
    },
    values: { "field-a": "SO-001" },
    output: { type: "pdf", pageLimit: null },
    ...overrides,
  };
}

async function signedHttpRequest(
  body: AutomationRenderRequest,
  options: { token?: string; bodyText?: string; contentType?: string } = {},
): Promise<Request> {
  const token = options.token ?? await signRendererRequest(body, secret, now);
  return new Request("https://renderer.example/v1/render", {
    method: "POST",
    headers: {
      "x-duowei-service-signature": token,
      "content-type": options.contentType ?? "application/json",
    },
    body: options.bodyText ?? JSON.stringify(body),
  });
}

test("IT-AUTO-01/08: authenticated duplicate HTTP renders reuse one valid artifact", async () => {
  let renders = 0;
  const handler = createRendererHttpHandler({
    signingSecret: secret,
    now: () => now,
    async render(request) {
      renders += 1;
      return {
        artifactKey: request.artifactKey,
        fileName: "发货单.pdf",
        contentType: "application/pdf",
        pageCount: 1,
        bytes: pdfBytes,
      };
    },
  });
  const input = renderRequest();
  const token = await signRendererRequest(input, secret, now);
  const [first, second] = await Promise.all([
    handler(await signedHttpRequest(input, { token })),
    handler(await signedHttpRequest(input, { token })),
  ]);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(renders, 1);
  assert.equal(first.headers.get("content-type"), "application/pdf");
  assert.equal(first.headers.get("x-duowei-artifact-key"), input.artifactKey);
  assert.equal(first.headers.get("x-duowei-page-count"), "1");
  assert.equal(new TextDecoder().decode(await first.arrayBuffer()).slice(0, 5), "%PDF-");
});

test("SPEC-AUTO-06/08: renderer rejects anonymous, tampered, expired, and credential-bearing requests", async () => {
  let renders = 0;
  const handler = createRendererHttpHandler({
    signingSecret: secret,
    now: () => now,
    async render(request) {
      renders += 1;
      return {
        artifactKey: request.artifactKey,
        fileName: "发货单.pdf",
        contentType: "application/pdf",
        pageCount: 1,
        bytes: pdfBytes,
      };
    },
  });
  const body = renderRequest();
  const validToken = await signRendererRequest(body, secret, now);
  const expiredToken = await signRendererRequest(body, secret, now - 10 * 60_000);
  const credentialBody = {
    ...body,
    values: { ...body.values, tenantAccessToken: "tenant-secret" },
  } as AutomationRenderRequest;
  const requests = [
    new Request("https://renderer.example/v1/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    await signedHttpRequest({ ...body, values: { "field-a": "tampered" } }, { token: validToken }),
    await signedHttpRequest(body, { token: expiredToken }),
    await signedHttpRequest(credentialBody, { token: validToken }),
  ];

  for (const request of requests) {
    const response = await handler(request);
    assert.notEqual(response.status, 200);
    const error = await response.json() as { traceId?: string; code?: string; message?: string };
    assert.ok(error.traceId);
    assert.ok(error.code);
    assert.doesNotMatch(JSON.stringify(error), /tenant-secret/);
  }
  assert.equal(renders, 0);
});

test("SPEC-AUTO-08: renderer enforces JSON size and timeout limits without returning partial files", async () => {
  let aborted = false;
  const handler = createRendererHttpHandler({
    signingSecret: secret,
    now: () => now,
    maxRequestBytes: 300,
    timeoutMs: 10,
    async render() {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return {
        artifactKey: "duowei:v1:artifact-a",
        fileName: "late.pdf",
        contentType: "application/pdf",
        pageCount: 1,
        bytes: pdfBytes,
      };
    },
  });
  const oversized = renderRequest({ values: { "field-a": "x".repeat(400) } });
  const oversizedResponse = await handler(await signedHttpRequest(oversized));
  assert.equal(oversizedResponse.status, 413);
  assert.equal(oversizedResponse.headers.get("content-type"), "application/json; charset=utf-8");

  const timeoutHandler = createRendererHttpHandler({
    signingSecret: secret,
    now: () => now,
    timeoutMs: 10,
    async render(_request, signal) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 30);
        signal?.addEventListener("abort", () => {
          aborted = true;
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
      return {
        artifactKey: "duowei:v1:artifact-a",
        fileName: "late.pdf",
        contentType: "application/pdf",
        pageCount: 1,
        bytes: pdfBytes,
      };
    },
  });
  const timeoutResponse = await timeoutHandler(await signedHttpRequest(renderRequest()));
  assert.equal(timeoutResponse.status, 504);
  assert.equal(aborted, true);
  assert.equal(timeoutResponse.headers.get("content-type"), "application/json; charset=utf-8");
  assert.match(JSON.stringify(await timeoutResponse.json()), /超时/);
});

test("IT-AUTO-01: HTTP client signs the exact minimal request and restores binary metadata", async () => {
  let receivedBody = "";
  let receivedAuthorization = "";
  const handler = createRendererHttpHandler({
    signingSecret: secret,
    now: () => now,
    async render(request) {
      return {
        artifactKey: request.artifactKey,
        fileName: "发货单.pdf",
        contentType: "application/pdf",
        pageCount: 1,
        bytes: pdfBytes,
      };
    },
  });
  const client = createRendererHttpClient({
    endpoint: "https://renderer.example/v1/render",
    signingSecret: secret,
    now: () => now,
    async fetch(input, init) {
      receivedAuthorization = new Headers(init?.headers).get("x-duowei-service-signature") ?? "";
      receivedBody = String(init?.body ?? "");
      return handler(new Request(input, init));
    },
  });

  const result = await client.render(renderRequest());
  assert.match(receivedAuthorization, /^duowei-renderer-v1\./);
  assert.equal(receivedBody.includes("tenantAccessToken"), false);
  assert.equal(result.fileName, "发货单.pdf");
  assert.equal(result.pageCount, 1);
  assert.equal(new TextDecoder().decode(result.bytes).slice(0, 5), "%PDF-");
});
