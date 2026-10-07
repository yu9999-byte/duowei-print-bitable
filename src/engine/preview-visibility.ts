type VisibilityPage = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;

function waitForVisible(page: VisibilityPage): Promise<void> {
  if (page.visibilityState !== "hidden") return Promise.resolve();
  return new Promise((resolve) => {
    const onVisibilityChange = () => {
      if (page.visibilityState === "hidden") return;
      page.removeEventListener("visibilitychange", onVisibilityChange);
      resolve();
    };
    page.addEventListener("visibilitychange", onVisibilityChange);
  });
}

export async function renderWhenVisible<T>(
  render: () => Promise<T>,
  page?: VisibilityPage,
): Promise<T> {
  const visiblePage = page ?? (typeof document === "undefined" ? null : document);
  if (!visiblePage) return render();
  await waitForVisible(visiblePage);
  try {
    return await render();
  } catch (cause) {
    if (!(cause instanceof Error)
      || !cause.message.startsWith("Print renderer timeout:")
      || visiblePage.visibilityState !== "hidden") throw cause;
    await waitForVisible(visiblePage);
    return render();
  }
}
