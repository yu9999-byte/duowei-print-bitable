import { bitable } from "@lark-base-open/js-sdk";
import { createHostTemplateRepository, createSharedTemplateHttpTransport, createSharedTemplateRepository, createSharedTemplateResilientTransport } from "./shared-template-storage.ts";
import { createSharedTemplateBridge } from "./shared-template-bridge.ts";
import { createTemplateRepository } from "../core/template-repository.ts";
import { migrateLegacyTemplates } from "./shared-template-migration.ts";

declare const __DUOWEI_SHARED_TEMPLATE_ENDPOINT__: string;

const endpoint = typeof __DUOWEI_SHARED_TEMPLATE_ENDPOINT__ === "undefined" ? "" : __DUOWEI_SHARED_TEMPLATE_ENDPOINT__;
export const sharedTemplateBridge = endpoint ? createSharedTemplateBridge(endpoint) : null;
export const legacyTemplateRepository = createTemplateRepository(bitable.bridge);
const sharedTemplateTransport = sharedTemplateBridge
  ? createSharedTemplateResilientTransport({
    direct: createSharedTemplateHttpTransport({ endpoint }),
    bridge: sharedTemplateBridge.transport,
  })
  : null;
export const ensureSharedTemplateMigration = (context: { baseId: string; tableId: string }) => sharedTemplateTransport
  ? migrateLegacyTemplates({ legacy: bitable.bridge, shared: sharedTemplateTransport, context })
  : Promise.resolve();
export const templateRepository = sharedTemplateTransport ? createSharedTemplateRepository(sharedTemplateTransport) : createHostTemplateRepository({
  legacyStorage: bitable.bridge,
  sharedEndpoint: "",
});
