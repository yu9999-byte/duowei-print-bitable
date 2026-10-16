import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";
import type { AutomationRenderRequest } from "../../src/automation/automation-domain.ts";
import type {
  HeadlessBrowserRuntime,
  SerializedRenderedArtifact,
} from "../../src/automation/headless-renderer.ts";

export function createPlaywrightBrowserRuntime(rendererEntryPath: string): {
  runtime: HeadlessBrowserRuntime;
  close(): Promise<void>;
} {
  const rendererUrl = pathToFileURL(rendererEntryPath).toString();
  let browserPromise: Promise<Browser> | null = null;
  const browser = () => {
    browserPromise ??= chromium.launch({ headless: true });
    return browserPromise;
  };
  let queue: Promise<void> = Promise.resolve();
  return {
    runtime: {
      async openPage() {
        const previous = queue;
        let releaseQueue = () => {};
        queue = new Promise<void>((resolve) => { releaseQueue = resolve; });
        await previous;
        let released = false;
        let page;
        try {
          page = await (await browser()).newPage();
        } catch (error) {
          released = true;
          releaseQueue();
          throw error;
        }
        try {
          await page.goto(rendererUrl, { waitUntil: "load", timeout: 30_000 });
          await page.waitForFunction(
            () => Boolean((globalThis as { __DUOWEI_AUTOMATION_RENDERER__?: unknown })
              .__DUOWEI_AUTOMATION_RENDERER__),
            undefined,
            { timeout: 30_000 },
          );
        } catch (error) {
          if (!released) {
            released = true;
            releaseQueue();
          }
          await page.close();
          throw error;
        }
        return {
          async render(request: AutomationRenderRequest): Promise<SerializedRenderedArtifact> {
            return page.evaluate(async (input) => {
              const api = (globalThis as unknown as {
                __DUOWEI_AUTOMATION_RENDERER__?: {
                  render(value: AutomationRenderRequest): Promise<SerializedRenderedArtifact>;
                };
              }).__DUOWEI_AUTOMATION_RENDERER__;
              if (!api) throw new Error("自动化渲染页尚未就绪");
              return api.render(input);
            }, request);
          },
          async close() {
            await page.close();
            if (!released) {
              released = true;
              releaseQueue();
            }
          },
        };
      },
    },
    async close() {
      if (browserPromise) await (await browserPromise).close();
    },
  };
}
