function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Clone data that crosses the host/designer boundary.
 *
 * Vue and web-component APIs may expose JSON-compatible values through
 * reactive Proxies. Browsers reject those Proxies in structuredClone even
 * though the underlying template can be persisted as JSON. Prefer the native
 * clone for normal values and fall back to a JSON round trip for that boundary
 * case.
 */
export function cloneJsonValue<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch (structuredCause) {
    try {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) throw new Error("JSON 序列化没有产生结果");
      return JSON.parse(serialized) as T;
    } catch (jsonCause) {
      throw new Error(
        `数据无法安全复制：${messageOf(structuredCause)}；JSON 回退失败：${messageOf(jsonCause)}`,
      );
    }
  }
}
