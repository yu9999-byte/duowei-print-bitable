export const DEFAULT_READ_TIMEOUT_MS = 15_000;

export class BitableReadTimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`读取多维表格数据超时：${operation}（${timeoutMs}ms）；请重试，原打印任务已保留`);
    this.name = "BitableReadTimeoutError";
  }
}

export function withReadTimeout<T>(
  operation: string,
  value: PromiseLike<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new BitableReadTimeoutError(operation, timeoutMs));
    }, timeoutMs);
    Promise.resolve(value).then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
