const required = ["DUOWEI_TEMPLATE_SYNC_BRIDGE_ENDPOINT"];

for (const key of required) {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`记录视图发布缺少配置 ${key}`);
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error(`记录视图发布配置 ${key} 不是有效 URL`);
  }
  if (endpoint.protocol !== "https:") throw new Error(`记录视图发布配置 ${key} 必须使用 https:`);
  if (endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error(`记录视图发布配置 ${key} 不得包含凭据或片段`);
  }
}

process.stdout.write("Record-view automation bridge endpoint configured.\n");
