package com.duowei.print.integration.feishu;

import com.duowei.print.repository.AppTicketRepository;
import com.duowei.print.security.Protocol;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.HashMap;
import java.util.Map;
import java.util.function.LongSupplier;

/** Optional marketplace token exchange; the worker continues using ephemeral credentials. */
public final class MarketplaceTokenProvider {
    private final String appId, appSecret;
    private final AppTicketRepository tickets;
    private final FeishuClient api;
    private final LongSupplier clock;
    private final Map<String, Entry> tenants = new HashMap<>();
    private Entry application;

    public MarketplaceTokenProvider(
            String appId,
            String appSecret,
            AppTicketRepository tickets,
            FeishuClient api,
            LongSupplier clock) {
        if (appId == null
                || appId.trim().isEmpty()
                || appSecret == null
                || appSecret.trim().isEmpty()) throw new IllegalArgumentException("商店应用令牌配置不完整");
        this.appId = appId.trim();
        this.appSecret = appSecret.trim();
        this.tickets = tickets;
        this.api = api;
        this.clock = clock;
    }

    public synchronized String getTenantAccessToken(String rawTenantKey) {
        if (rawTenantKey == null || rawTenantKey.trim().isEmpty())
            throw new IllegalArgumentException("租户标识为空");
        String tenant = rawTenantKey.trim();
        Entry cached = tenants.get(tenant);
        if (fresh(cached)) return cached.token;
        if (!fresh(application)) {
            String ticket = tickets.get(appId);
            if (ticket == null) throw new IllegalStateException("尚未收到飞书 app_ticket，后台生成暂不可用");
            JsonNode response =
                    api.post(
                            "https://open.feishu.cn/open-apis/auth/v3/app_access_token",
                            Protocol.JSON
                                    .createObjectNode()
                                    .put("app_id", appId)
                                    .put("app_secret", appSecret)
                                    .put("app_ticket", ticket),
                            null);
            application = entry(response, "app_access_token");
        }
        JsonNode response =
                api.post(
                        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token",
                        Protocol.JSON
                                .createObjectNode()
                                .put("app_access_token", application.token)
                                .put("tenant_key", tenant),
                        null);
        Entry result = entry(response, "tenant_access_token");
        tenants.put(tenant, result);
        return result.token;
    }

    private boolean fresh(Entry entry) {
        return entry != null && entry.expiresAt - clock.getAsLong() > 1800000;
    }

    private Entry entry(JsonNode response, String field) {
        String token = Protocol.required(response, field);
        double seconds = response.path("expire").asDouble(3600);
        if (!Double.isFinite(seconds)) seconds = 3600;
        return new Entry(token, clock.getAsLong() + (long) (seconds * 1000));
    }

    private static final class Entry {
        final String token;
        final long expiresAt;

        Entry(String token, long expiresAt) {
            this.token = token;
            this.expiresAt = expiresAt;
        }
    }
}
