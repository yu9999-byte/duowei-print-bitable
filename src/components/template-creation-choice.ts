export type TemplateCreateKind = "blank" | "automatic";

export const TEMPLATE_CREATION_OPTIONS: ReadonlyArray<{
  kind: TemplateCreateKind;
  label: string;
  description: string;
}> = [
  { kind: "blank", label: "空白模板", description: "从空白纸张开始设计" },
  { kind: "automatic", label: "自动生成模板", description: "根据当前表字段生成初始排版" },
] as const;
