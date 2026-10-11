export type TemplateCandidateOptions<TTemplate, TRendered> = {
  template: TTemplate;
  load: (template: TTemplate) => Promise<void>;
  render: () => Promise<TRendered>;
  restore: () => Promise<void>;
};

export type PreparedTemplateCandidate<TTemplate, TRendered> = {
  template: TTemplate;
  rendered: TRendered;
};

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

type AggregateErrorConstructor = new (errors: Iterable<unknown>, message?: string) => Error;

const AggregateErrorClass = (globalThis as typeof globalThis & {
  AggregateError: AggregateErrorConstructor;
}).AggregateError;

/**
 * Loads and renders a candidate template without committing caller-owned state.
 * If either preparation step fails, the designer is restored before the
 * original error is rethrown.
 */
export async function prepareTemplateCandidate<TTemplate, TRendered>(
  options: TemplateCandidateOptions<TTemplate, TRendered>,
): Promise<PreparedTemplateCandidate<TTemplate, TRendered>> {
  try {
    await options.load(options.template);
    const rendered = await options.render();
    return { template: options.template, rendered };
  } catch (cause) {
    try {
      await options.restore();
    } catch (restoreCause) {
      throw new AggregateErrorClass(
        [cause, restoreCause],
        `模板准备失败：${errorMessage(cause)}；恢复原模板失败：${errorMessage(restoreCause)}`,
      );
    }
    throw cause;
  }
}
