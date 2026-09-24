import { bitable } from "@lark-base-open/js-sdk";
import { createTemplateRepository } from "../core/template-repository.ts";

export const templateRepository = createTemplateRepository(bitable.bridge);
