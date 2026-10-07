import { BitableReadTimeoutError } from "../host/read-timeout.ts";

export type BatchReadFailureFeedback = {
  status: "未更改打印记录";
  error: string;
  retryAvailable: boolean;
};

export function getBatchReadFailureFeedback(cause: unknown): BatchReadFailureFeedback {
  return {
    status: "未更改打印记录",
    error: cause instanceof Error ? cause.message : "批量选择失败；原打印任务已保留",
    retryAvailable: cause instanceof BitableReadTimeoutError,
  };
}

export function shouldShowBatchReadRetry(retryAvailable: boolean, busy: boolean): boolean {
  return retryAvailable && !busy;
}
