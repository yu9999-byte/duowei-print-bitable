import assert from "node:assert/strict";
import test from "node:test";
import {
  getBatchReadFailureFeedback,
  shouldShowBatchReadRetry,
} from "../src/components/batch-read-feedback.ts";
import { BitableReadTimeoutError } from "../src/host/read-timeout.ts";

test("CT-BATCH-07-UI: a timed-out batch read exposes retry without claiming the batch changed", () => {
  const feedback = getBatchReadFailureFeedback(
    new BitableReadTimeoutError("读取记录", 15_000),
  );

  assert.equal(feedback.status, "未更改打印记录");
  assert.match(feedback.error, /请重试，原打印任务已保留/);
  assert.equal(feedback.retryAvailable, true);
  assert.equal(shouldShowBatchReadRetry(feedback.retryAvailable, false), true);
});

test("CT-BATCH-07-UI: retry stays hidden while another operation is busy", () => {
  const feedback = getBatchReadFailureFeedback(
    new BitableReadTimeoutError("获取当前多维表格选择", 15_000),
  );

  assert.equal(shouldShowBatchReadRetry(feedback.retryAvailable, true), false);
});

test("CT-BATCH-07-UI: ordinary failures do not offer a misleading timeout retry", () => {
  const feedback = getBatchReadFailureFeedback(new Error("记录无权访问"));

  assert.deepEqual(feedback, {
    status: "未更改打印记录",
    error: "记录无权访问",
    retryAvailable: false,
  });
  assert.equal(shouldShowBatchReadRetry(feedback.retryAvailable, false), false);
});
