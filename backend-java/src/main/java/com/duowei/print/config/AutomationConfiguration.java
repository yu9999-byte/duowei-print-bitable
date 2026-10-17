package com.duowei.print.config;

import java.net.URI;
import java.util.*;
import javax.annotation.PostConstruct;
import org.springframework.stereotype.Component;

/** Validates deployment invariants before any request is accepted. */
@Component
public class AutomationConfiguration {
    private final Map<String, String> values;

    public AutomationConfiguration() {
        this(System.getenv());
    }

    public AutomationConfiguration(Map<String, String> values) {
        this.values = values;
    }

    public String required(String key) {
        String value = values.get(key);
        if (value == null || value.trim().isEmpty()) throw new IllegalStateException(key + "不能为空");
        return value.trim();
    }

    public byte[] signingSecret(String key) {
        String hex = required(key);
        if (!hex.matches("(?i)[0-9a-f]{64,}") || hex.length() % 2 != 0)
            throw new IllegalStateException(key + "密钥格式无效");
        byte[] bytes = new byte[hex.length() / 2];
        for (int i = 0; i < bytes.length; i++)
            bytes[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        return bytes;
    }

    public URI secureUrl(String key) {
        URI uri = URI.create(required(key));
        boolean local =
                "true".equals(values.get("DUOWEI_ALLOW_INSECURE_LOCAL_RENDERER"))
                        && "http".equals(uri.getScheme())
                        && Arrays.asList("localhost", "127.0.0.1").contains(uri.getHost());
        if ((!"https".equals(uri.getScheme()) && !local)
                || uri.getHost() == null
                || uri.getUserInfo() != null
                || uri.getFragment() != null)
            throw new IllegalStateException(key + "必须使用无凭据的HTTPS地址");
        return uri;
    }

    public long workerInterval() {
        String raw = values.getOrDefault("DUOWEI_BACKGROUND_WORKER_INTERVAL_MS", "2000").trim();
        long value;
        try {
            if (raw.matches("0[xX][0-9a-fA-F]+"))
                value = new java.math.BigInteger(raw.substring(2), 16).longValueExact();
            else if (raw.matches("0[bB][01]+"))
                value = new java.math.BigInteger(raw.substring(2), 2).longValueExact();
            else if (raw.matches("0[oO][0-7]+"))
                value = new java.math.BigInteger(raw.substring(2), 8).longValueExact();
            else value = new java.math.BigDecimal(raw).longValueExact();
        } catch (RuntimeException invalid) {
            throw new IllegalStateException("Worker间隔必须为250到60000毫秒的整数");
        }
        if (value < 250 || value > 60000) throw new IllegalStateException("Worker间隔必须为250到60000毫秒");
        return value;
    }

    public Set<String> allowedOrigins() {
        Set<String> result = new LinkedHashSet<>();
        for (String item : required("DUOWEI_ALLOWED_ORIGINS").split(",")) {
            if (item.trim().isEmpty()) continue;
            URI uri = URI.create(item.trim());
            if (!"https".equals(uri.getScheme())
                    || uri.getHost() == null
                    || uri.getUserInfo() != null
                    || uri.getQuery() != null
                    || uri.getFragment() != null
                    || !(uri.getPath().isEmpty() || "/".equals(uri.getPath())))
                throw new IllegalStateException("允许来源必须为HTTPS origin");
            result.add(
                    "https://"
                            + uri.getHost().toLowerCase(Locale.ROOT)
                            + (uri.getPort() == -1 || uri.getPort() == 443
                                    ? ""
                                    : ":" + uri.getPort()));
        }
        if (result.isEmpty()) throw new IllegalStateException("至少需要一个允许来源");
        return Collections.unmodifiableSet(result);
    }

    @PostConstruct
    public void validate() {
        if (!required("DUOWEI_SERVICE_AUTHORIZATION").matches("(?i)Bearer\\s+\\S+"))
            throw new IllegalStateException("服务凭据必须使用Bearer格式");
        for (String key :
                Arrays.asList(
                        "DUOWEI_REGISTRY_WRITE_SIGNING_SECRET_HEX",
                        "DUOWEI_REGISTRY_READ_SIGNING_SECRET_HEX",
                        "DUOWEI_RENDERER_SIGNING_SECRET_HEX",
                        "DUOWEI_BACKGROUND_JOB_SIGNING_SECRET_HEX")) {
            String hex = required(key);
            if (!hex.matches("(?i)[0-9a-f]{64,}") || hex.length() % 2 != 0)
                throw new IllegalStateException(key + "密钥长度或格式无效");
        }
        if (!required("DUOWEI_FEISHU_APP_ID").matches("cli_[A-Za-z0-9]+"))
            throw new IllegalStateException("App ID格式无效");
        required("DUOWEI_FEISHU_APP_SECRET");
        required("DUOWEI_EVENT_VERIFICATION_TOKEN");
        workerInterval();
        allowedOrigins();
        secureUrl("DUOWEI_RENDER_PAGE_URL");
        URI base = secureUrl("DUOWEI_PUBLIC_AUTOMATION_BASE_URL"),
                callback = secureUrl("DUOWEI_OAUTH_REDIRECT_URI");
        String path = base.getPath().replaceAll("/+$", "");
        if (!path.endsWith("/openapi/duowei-print") || base.getQuery() != null)
            throw new IllegalStateException("公网地址必须为OpenAPI根路径");
        if (!Objects.equals(base.getScheme(), callback.getScheme())
                || !Objects.equals(base.getAuthority(), callback.getAuthority())
                || callback.getQuery() != null
                || !Arrays.asList(
                                path + "/oauth/callback",
                                path.replace(
                                        "/openapi/duowei-print", "/api/automation/oauth/callback"))
                        .contains(callback.getPath()))
            throw new IllegalStateException("OAuth回调地址不匹配");
    }
}
