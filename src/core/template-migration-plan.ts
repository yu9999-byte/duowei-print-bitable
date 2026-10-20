import type { TemplateCollection, TemplateContext, TemplateRepository } from "./template-repository.ts";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export type TemplateMigrationPlan = {
  context: TemplateContext;
  source: TemplateCollection;
  targetRevision: string | null;
  conflicts: string[];
  disposition: "empty-source" | "import-into-empty-target" | "already-identical" | "manual-resolution";
};

/** Read-only inventory. A plan is neither an import nor permission to switch storage. */
export async function planTemplateMigration(options: {
  source: TemplateRepository;
  target: TemplateRepository;
  context: TemplateContext;
}): Promise<TemplateMigrationPlan> {
  const [source, target] = await Promise.all([
    options.source.list(options.context), options.target.list(options.context),
  ]);
  const targetItems = new Map(target.templates.map((item) => [item.id, item]));
  const conflicts = source.templates.filter((item) => {
    const other = targetItems.get(item.id);
    return other !== undefined && canonical(other) !== canonical(item);
  }).map((item) => item.id);
  let disposition: TemplateMigrationPlan["disposition"] = "manual-resolution";
  if (!source.templates.length) disposition = "empty-source";
  else if (!target.templates.length && target.revision === null) disposition = "import-into-empty-target";
  else if (canonical(source) === canonical(target)) disposition = "already-identical";
  return structuredClone({ context: options.context, source, targetRevision: target.revision, conflicts, disposition });
}
