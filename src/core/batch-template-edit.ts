export type BatchTemplateEditSuccess<TSaved, TRendered> = {
  ok: true;
  saved: TSaved;
  rendered: TRendered;
};

export type BatchTemplateEditRenderFailure<TSaved, TRendered> = {
  ok: false;
  saved: TSaved;
  rendered: TRendered;
  error: Error;
};

/**
 * Persists one shared template before preparing its replacement batch pages.
 * A rendering failure returns the exact committed page object so the UI never
 * exposes a partially regenerated batch or clears the last printable result.
 */
export async function commitBatchTemplateEdit<TSaved, TRendered>(input: {
  previousRendered: TRendered;
  persist: () => Promise<TSaved>;
  render: () => Promise<TRendered>;
}): Promise<BatchTemplateEditSuccess<TSaved, TRendered> | BatchTemplateEditRenderFailure<TSaved, TRendered>> {
  const saved = await input.persist();
  try {
    return { ok: true, saved, rendered: await input.render() };
  } catch (cause) {
    return {
      ok: false,
      saved,
      rendered: input.previousRendered,
      error: cause instanceof Error ? cause : new Error("批次预览刷新失败"),
    };
  }
}
