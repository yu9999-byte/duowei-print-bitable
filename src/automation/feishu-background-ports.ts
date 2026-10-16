import type {
  AppTicketStore,
} from "./feishu-app-ticket.ts";
import type {
  BackgroundJob,
  BackgroundJobPorts,
  PreparedBackgroundTargets,
} from "./background-job.ts";
import type { RenderedArtifact } from "./automation-artifact.ts";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type MarketplaceTokenProvider = {
  getTenantAccessToken(tenantKey: string): Promise<string>;
};

type TokenCacheEntry = { token: string; expiresAt: number };

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function safeMessage(value: unknown): string {
  return (typeof value === "string" ? value : "未知错误")
    .replace(/Bearer\s+\S+/gi, "Bearer [已隐藏]")
    .slice(0, 300);
}

async function apiJson(response: Response, label: string): Promise<Record<string, unknown>> {
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new Error(`${label}没有返回有效 JSON`); }
  const result = object(payload);
  if (!result) throw new Error(`${label}返回格式无效`);
  if (!response.ok || result.code !== 0) throw new Error(`${label}失败：${safeMessage(result.msg ?? response.statusText)}`);
  return result;
}

export function createMarketplaceTokenProvider(options: {
  appId: string;
  appSecret: string;
  ticketStore: Pick<AppTicketStore, "get">;
  fetch?: FetchLike;
  now?: () => number;
}): MarketplaceTokenProvider {
  const appId = options.appId.trim();
  const appSecret = options.appSecret.trim();
  if (!appId || !appSecret) throw new Error("商店应用令牌配置不完整");
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let appToken: TokenCacheEntry | null = null;
  const tenantTokens = new Map<string, TokenCacheEntry>();

  const getAppToken = async () => {
    if (appToken && appToken.expiresAt - now() > 30 * 60_000) return appToken.token;
    const ticket = await options.ticketStore.get();
    if (!ticket) throw new Error("尚未收到飞书 app_ticket，后台生成暂不可用");
    const response = await fetcher("https://open.feishu.cn/open-apis/auth/v3/app_access_token", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret, app_ticket: ticket.ticket }),
    });
    const payload = await apiJson(response, "获取 app_access_token");
    if (typeof payload.app_access_token !== "string" || !payload.app_access_token.trim()) {
      throw new Error("获取 app_access_token 返回空凭据");
    }
    const expire = Number(payload.expire);
    appToken = {
      token: payload.app_access_token,
      expiresAt: now() + (Number.isFinite(expire) ? expire : 3600) * 1000,
    };
    return appToken.token;
  };

  return {
    async getTenantAccessToken(rawTenantKey) {
      const tenantKey = rawTenantKey.trim();
      if (!tenantKey) throw new Error("租户标识为空");
      const cached = tenantTokens.get(tenantKey);
      if (cached && cached.expiresAt - now() > 30 * 60_000) return cached.token;
      const response = await fetcher("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ app_access_token: await getAppToken(), tenant_key: tenantKey }),
      });
      const payload = await apiJson(response, "获取 tenant_access_token");
      if (typeof payload.tenant_access_token !== "string" || !payload.tenant_access_token.trim()) {
        throw new Error("获取 tenant_access_token 返回空凭据");
      }
      const expire = Number(payload.expire);
      const entry = {
        token: payload.tenant_access_token,
        expiresAt: now() + (Number.isFinite(expire) ? expire : 3600) * 1000,
      };
      tenantTokens.set(tenantKey, entry);
      return entry.token;
    },
  };
}

type FieldMetadata = { id: string; name: string; type: number; uiType: string };

function fieldListUrl(job: BackgroundJob, pageToken?: string): string {
  const url = new URL(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(job.submission.baseToken)}`
      + `/tables/${encodeURIComponent(job.submission.tableId)}/fields`,
  );
  url.searchParams.set("page_size", "100");
  if (pageToken) url.searchParams.set("page_token", pageToken);
  return url.toString();
}

export function createFeishuBackgroundPorts(options: {
  tokenProvider: MarketplaceTokenProvider;
  fetch?: FetchLike;
}): Omit<BackgroundJobPorts, "render"> {
  const fetcher = options.fetch ?? fetch;

  const fields = async (job: BackgroundJob, token: string): Promise<FieldMetadata[]> => {
    const result: FieldMetadata[] = [];
    let pageToken: string | undefined;
    do {
      const response = await fetcher(fieldListUrl(job, pageToken), {
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
      });
      const payload = await apiJson(response, "读取字段列表");
      const data = object(payload.data);
      if (!data || !Array.isArray(data.items)) throw new Error("读取字段列表返回格式无效");
      for (const item of data.items) {
        const field = object(item);
        if (!field || typeof field.field_id !== "string" || typeof field.field_name !== "string") continue;
        result.push({
          id: field.field_id,
          name: field.field_name,
          type: Number(field.type),
          uiType: typeof field.ui_type === "string" ? field.ui_type : "",
        });
      }
      pageToken = data.has_more === true && typeof data.page_token === "string" ? data.page_token : undefined;
    } while (pageToken);
    return result;
  };

  const tokenFor = (job: BackgroundJob) => options.tokenProvider.getTenantAccessToken(job.submission.tenantKey);

  return {
    async prepareTargets(job) {
      const metadata = await fields(job, await tokenFor(job));
      const byId = new Map(metadata.map((field) => [field.id, field]));
      const attachment = byId.get(job.submission.targets.attachmentFieldId);
      const status = byId.get(job.submission.targets.statusFieldId);
      const error = job.submission.targets.errorFieldId
        ? byId.get(job.submission.targets.errorFieldId)
        : undefined;
      if (!attachment || attachment.type !== 17) throw new Error("后台模式选择的附件字段不存在或类型已变化");
      if (!status || status.type !== 1) throw new Error("后台模式选择的状态字段不存在或不是文本字段");
      if (job.submission.targets.errorFieldId && (!error || error.type !== 1)) {
        throw new Error("后台模式选择的错误字段不存在或不是文本字段");
      }
      return {
        attachmentFieldName: attachment.name,
        statusFieldName: status.name,
        ...(error ? { errorFieldName: error.name } : {}),
      } satisfies PreparedBackgroundTargets;
    },
    async updateRecord(job, _targets, values) {
      const token = await tokenFor(job);
      const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(job.submission.baseToken)}`
        + `/tables/${encodeURIComponent(job.submission.tableId)}`
        + `/records/${encodeURIComponent(job.submission.recordId)}`;
      const response = await fetcher(url, {
        method: "PUT",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ fields: values }),
      });
      await apiJson(response, "更新自动化记录");
    },
    async uploadArtifact(job, artifact: RenderedArtifact) {
      if (artifact.bytes.byteLength > 20 * 1024 * 1024) throw new Error("生成文件超过飞书单次附件上传 20 MB 限制");
      const form = new FormData();
      form.set("file_name", artifact.fileName);
      form.set("parent_type", "bitable_file");
      form.set("parent_node", job.submission.baseToken);
      form.set("size", String(artifact.bytes.byteLength));
      form.set("file", new Blob([artifact.bytes as BlobPart], { type: artifact.contentType }), artifact.fileName);
      const response = await fetcher("https://open.feishu.cn/open-apis/drive/v1/medias/upload_all", {
        method: "POST",
        headers: { authorization: `Bearer ${await tokenFor(job)}` },
        body: form,
      });
      const payload = await apiJson(response, "上传自动化附件");
      const data = object(payload.data);
      if (!data || typeof data.file_token !== "string" || !data.file_token.trim()) {
        throw new Error("上传自动化附件没有返回 file_token");
      }
      return data.file_token.trim();
    },
  };
}
