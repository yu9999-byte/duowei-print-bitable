type BatchLayoutChangeOptions<TRendered, TSaved> = {
  applyCandidate: () => Promise<void>;
  renderCandidate: () => Promise<TRendered>;
  prepareEditableProjection?: () => Promise<void>;
  persistCandidate: () => Promise<TSaved>;
  restoreCommitted: () => Promise<void>;
};

export type BatchLayoutChangeResult<TRendered, TSaved> = {
  rendered: TRendered;
  saved: TSaved;
};

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

type AggregateErrorConstructor = new (errors: Iterable<unknown>, message?: string) => Error;

const AggregateErrorClass = (globalThis as typeof globalThis & {
  AggregateError: AggregateErrorConstructor;
}).AggregateError;

/**
 * Prepares a batch-layout candidate without exposing it as committed state.
 * Rendering and the optional full-batch edit projection must both succeed
 * before persistence. Any failure restores the last committed effective
 * canvas; caller-owned preview/session state is updated only from the result.
 */
export async function commitBatchLayoutChange<TRendered, TSaved>(
  options: BatchLayoutChangeOptions<TRendered, TSaved>,
): Promise<BatchLayoutChangeResult<TRendered, TSaved>> {
  try {
    await options.applyCandidate();
    const rendered = await options.renderCandidate();
    await options.prepareEditableProjection?.();
    const saved = await options.persistCandidate();
    return { rendered, saved };
  } catch (cause) {
    try {
      await options.restoreCommitted();
    } catch (restoreCause) {
      throw new AggregateErrorClass(
        [cause, restoreCause],
        `批量排版切换失败：${message(cause)}；恢复原画布失败：${message(restoreCause)}`,
      );
    }
    throw cause;
  }
}
