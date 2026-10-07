const TOKEN_PATTERN = /@[A-Za-z0-9_.-]+/g;
const FIELD_PREFIX = "__duowei_field_";

export type DataSourceTokenDefinition = {
  id: string;
  label: string;
};

export type DataSourceTokenIssue = {
  kind: "ambiguous" | "missing" | "unavailable";
  label: string;
  token?: string;
};

export type DataSourceTokenResult = {
  content: string;
  issues: DataSourceTokenIssue[];
};

export type PastedDataSourceBinding = {
  label: string;
  token: string;
  offset?: number;
};

type PersistentOptions = {
  previousContent?: string;
  pastedBindings?: PastedDataSourceBinding[];
};

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((item) => String(item ?? "")).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function rawFieldId(sourceId: string): string | null {
  return sourceId.startsWith(FIELD_PREFIX) ? sourceId.slice(FIELD_PREFIX.length) : null;
}

export function createDataSourceTokenCodec(
  definitions: DataSourceTokenDefinition[],
  historicalFieldBindings: Record<string, string> = {},
) {
  const byId = new Map(definitions.map((source) => [source.id, source]));
  const byLabel = new Map<string, DataSourceTokenDefinition[]>();
  for (const source of definitions) {
    byLabel.set(source.label, [...(byLabel.get(source.label) ?? []), source]);
  }

  const historicalLabel = (sourceId: string) => {
    const fieldId = rawFieldId(sourceId);
    return historicalFieldBindings[sourceId]
      ?? (fieldId ? historicalFieldBindings[fieldId] : undefined)
      ?? "未知字段";
  };

  const invalidEditingLabel = (sourceId: string) =>
    `@${historicalLabel(sourceId)}（字段已失效）`;

  const toEditingContent = (persistentContent: string): DataSourceTokenResult => {
    const issues: DataSourceTokenIssue[] = [];
    const content = persistentContent.replace(TOKEN_PATTERN, (token) => {
      const sourceId = token.slice(1);
      const source = byId.get(sourceId);
      if (source) return `@${source.label}`;
      if (!sourceId.startsWith(FIELD_PREFIX)) return token;
      const label = historicalLabel(sourceId);
      issues.push({ kind: "missing", label, token });
      return invalidEditingLabel(sourceId);
    });
    return { content, issues };
  };

  const previousTokensByLabel = (content: string) => {
    const result = new Map<string, string[]>();
    for (const token of content.match(TOKEN_PATTERN) ?? []) {
      const sourceId = token.slice(1);
      const source = byId.get(sourceId);
      if (!source) continue;
      result.set(source.label, [...(result.get(source.label) ?? []), token]);
    }
    return result;
  };

  const invalidLabelsFromPrevious = (content: string) => {
    const result = new Map<string, string>();
    for (const token of content.match(TOKEN_PATTERN) ?? []) {
      const sourceId = token.slice(1);
      if (byId.has(sourceId) || !sourceId.startsWith(FIELD_PREFIX)) continue;
      result.set(invalidEditingLabel(sourceId), token);
    }
    return result;
  };

  const knownLabels = [...byLabel.keys()].sort((left, right) => right.length - left.length);

  const findFriendlyReferences = (content: string, invalidLabels: Map<string, string>) => {
    const invalidNames = [...invalidLabels.keys()].sort((left, right) => right.length - left.length);
    const matches: Array<{ start: number; end: number; label: string; invalidToken?: string }> = [];
    for (let index = 0; index < content.length; index += 1) {
      if (content[index] !== "@") continue;
      const invalidName = invalidNames.find((label) => content.startsWith(label, index));
      if (invalidName) {
        matches.push({
          start: index,
          end: index + invalidName.length,
          label: invalidName,
          invalidToken: invalidLabels.get(invalidName),
        });
        index += invalidName.length - 1;
        continue;
      }
      const sourceLabel = knownLabels.find((label) => content.startsWith(`@${label}`, index));
      if (!sourceLabel) continue;
      matches.push({ start: index, end: index + sourceLabel.length + 1, label: sourceLabel });
      index += sourceLabel.length;
    }
    return matches;
  };

  const toPersistentContent = (
    editingContent: string,
    options: PersistentOptions = {},
  ): DataSourceTokenResult => {
    const previousContent = options.previousContent ?? "";
    if (previousContent && !options.pastedBindings?.length &&
        toEditingContent(previousContent).content === editingContent) {
      return { content: previousContent, issues: [] };
    }

    const invalidLabels = invalidLabelsFromPrevious(previousContent);
    const matches = findFriendlyReferences(editingContent, invalidLabels);
    const previous = previousTokensByLabel(previousContent);
    const pasted = new Map<string, PastedDataSourceBinding[]>();
    for (const binding of options.pastedBindings ?? []) {
      pasted.set(binding.label, [...(pasted.get(binding.label) ?? []), binding]);
    }
    const occurrences = new Map<string, number[]>();
    for (const match of matches) {
      if (!match.invalidToken) {
        occurrences.set(match.label, [...(occurrences.get(match.label) ?? []), match.start]);
      }
    }
    const replacementQueues = new Map<string, string[] | null>();
    for (const [label, positions] of occurrences) {
      const definitionsForLabel = byLabel.get(label) ?? [];
      if (definitionsForLabel.length === 1) {
        replacementQueues.set(label, Array(positions.length).fill(`@${definitionsForLabel[0].id}`));
        continue;
      }
      const previousTokens = previous.get(label) ?? [];
      const slots: Array<string | null> = Array(positions.length).fill(null);
      let ambiguous = false;
      for (const binding of pasted.get(label) ?? []) {
        const position = binding.offset === undefined && positions.length === 1
          ? 0 : positions.indexOf(binding.offset ?? -1);
        if (position < 0 || slots[position] ||
            !definitionsForLabel.some((source) => binding.token === `@${source.id}`)) {
          ambiguous = true;
          break;
        }
        slots[position] = binding.token;
      }
      const unbound = slots.filter((token) => token === null).length;
      if (ambiguous || (unbound > 0 && previousTokens.length !== unbound)) {
        replacementQueues.set(label, null);
        continue;
      }
      let previousIndex = 0;
      replacementQueues.set(label, slots.map((token) => token ?? previousTokens[previousIndex++]));
    }

    const issues: DataSourceTokenIssue[] = [];
    let cursor = 0;
    let content = "";
    for (const match of matches) {
      content += editingContent.slice(cursor, match.start);
      if (match.invalidToken) {
        content += match.invalidToken;
      } else {
        const queue = replacementQueues.get(match.label);
        const token = queue?.shift();
        if (token) content += token;
        else {
          content += editingContent.slice(match.start, match.end);
          if (!issues.some((issue) => issue.kind === "ambiguous" && issue.label === match.label)) {
            issues.push({ kind: "ambiguous", label: match.label });
          }
        }
      }
      cursor = match.end;
    }
    content += editingContent.slice(cursor);
    return { content, issues };
  };

  const toRenderedContent = (
    persistentContent: string,
    values: Record<string, unknown>,
  ): DataSourceTokenResult => {
    const issues: DataSourceTokenIssue[] = [];
    const content = persistentContent.replace(TOKEN_PATTERN, (token) => {
      const sourceId = token.slice(1);
      const source = byId.get(sourceId);
      if (!source) {
        if (!sourceId.startsWith(FIELD_PREFIX)) return token;
        const label = historicalLabel(sourceId);
        issues.push({ kind: "missing", label, token });
        return `[字段已失效：${label}]`;
      }
      if (!Object.prototype.hasOwnProperty.call(values, sourceId)) {
        issues.push({ kind: "unavailable", label: source.label, token });
        return `[字段不可读取：${source.label}]`;
      }
      return displayValue(values[sourceId]);
    });
    return { content, issues };
  };

  return {
    toEditingContent,
    toPersistentContent,
    toRenderedContent,
  };
}

export type DataSourceTokenCodec = ReturnType<typeof createDataSourceTokenCodec>;
