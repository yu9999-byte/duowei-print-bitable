package com.duowei.print.service.oauth;

import com.duowei.print.integration.feishu.FeishuClient;
import com.duowei.print.security.Protocol;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import javax.servlet.http.*;
import org.springframework.http.*;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.bind.annotation.*;

@org.springframework.stereotype.Service
public class OAuthService {
    private final FeishuClient api;
    private final com.duowei.print.config.AutomationConfiguration configuration;
    private final Map<String, ObjectNode> pending = new ConcurrentHashMap<>(),
            sessions = new ConcurrentHashMap<>();
    private static final String COOKIE = "__Host-duowei_oauth_session";

    public OAuthService(
            FeishuClient api, com.duowei.print.config.AutomationConfiguration configuration) {
        this.api = api;
        this.configuration = configuration;
    }

    private String base() {
        return configuration.required("DUOWEI_PUBLIC_AUTOMATION_BASE_URL").replaceAll("/+$", "");
    }

    private String browser() {
        return base().replace("/openapi/duowei-print", "/api/automation");
    }

    private String random() {
        byte[] b = new byte[48];
        new java.security.SecureRandom().nextBytes(b);
        return Protocol.encode(b);
    }

    private void purge() {
        long now = System.currentTimeMillis();
        pending.entrySet().removeIf(e -> e.getValue().path("expiresAt").asLong() <= now);
        sessions.entrySet().removeIf(e -> e.getValue().path("expiresAt").asLong() <= now);
    }

    public ResponseEntity<?> authorize(HttpServletRequest req, ObjectNode body) {
        purge();
        JsonNode scope = body.path("scope");
        String b = Protocol.required(scope, "baseToken"), t = Protocol.required(scope, "tableId");
        if (body.size() != 2 || !body.path("template").isObject() || scope.size() != 2)
            throw new IllegalArgumentException("模板同步授权请求无效");
        String origin = req.getHeader("Origin"), plugin = req.getHeader("x-duowei-plugin-origin");
        Set<String> allowed =
                new HashSet<>(
                        Arrays.asList(configuration.required("DUOWEI_ALLOWED_ORIGINS").split(",")));
        boolean bridge = false;
        if (!allowed.contains(origin)) {
            if (java.net
                            .URI
                            .create(base())
                            .resolve("/")
                            .toString()
                            .replaceAll("/$", "")
                            .equals(origin)
                    && allowed.contains(plugin)) {
                origin = plugin;
                bridge = true;
            } else throw new SecurityException("请求来源不受信任");
        }
        String id = null;
        if (req.getCookies() != null)
            for (Cookie cookie : req.getCookies())
                if (COOKIE.equals(cookie.getName())) id = cookie.getValue();
        ObjectNode session = id == null ? null : sessions.get(id);
        if (session == null
                || !b.equals(session.path("baseToken").asText())
                || !t.equals(session.path("tableId").asText())) {
            String state = random();
            ObjectNode item = Protocol.JSON.createObjectNode();
            item.put("verifier", random());
            item.put("origin", origin);
            item.put("bridge", bridge);
            item.put("baseToken", b);
            item.put("tableId", t);
            item.put("expiresAt", System.currentTimeMillis() + 300000);
            pending.put(state, item);
            ObjectNode result = Protocol.JSON.createObjectNode();
            result.put("success", false);
            result.put("code", "AUTH_REQUIRED");
            result.put("connectUrl", browser() + "/oauth/start?state=" + state);
            return ResponseEntity.status(401).body(result);
        }
        ObjectNode authorized = body.deepCopy();
        ((ObjectNode) authorized.path("scope"))
                .put("tenantKey", session.path("tenantKey").asText());
        ObjectNode claims = session.deepCopy();
        claims.put("version", 1);
        claims.put("audience", "duowei-template-registry-write");
        claims.put("issuedAt", System.currentTimeMillis());
        claims.put("expiresAt", System.currentTimeMillis() + 300000);
        claims.put("nonce", UUID.randomUUID().toString());
        claims.put("bodyDigest", Protocol.digest(Protocol.canonical(authorized)));
        ObjectNode result = Protocol.JSON.createObjectNode();
        result.put("success", true);
        result.put(
                "authorization",
                Protocol.sign(
                        "duowei-registry-v1",
                        claims,
                        configuration.signingSecret("DUOWEI_REGISTRY_WRITE_SIGNING_SECRET_HEX")));
        result.set("body", authorized);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(result);
    }

    public ResponseEntity<?> start(String state) {
        purge();
        ObjectNode item = pending.get(state);
        if (item == null) return ResponseEntity.badRequest().body("连接请求已失效");
        String url =
                "https://accounts.feishu.cn/open-apis/authen/v1/authorize?client_id="
                        + FeishuClient.enc(configuration.required("DUOWEI_FEISHU_APP_ID"))
                        + "&response_type=code&redirect_uri="
                        + FeishuClient.enc(configuration.required("DUOWEI_OAUTH_REDIRECT_URI"))
                        + "&scope=bitable%3Aapp&state="
                        + FeishuClient.enc(state)
                        + "&code_challenge="
                        + Protocol.digest(item.path("verifier").asText())
                        + "&code_challenge_method=S256";
        return ResponseEntity.status(302)
                .header("Location", url)
                .cacheControl(CacheControl.noStore())
                .build();
    }

    public ResponseEntity<?> callback(String state, String code) {
        purge();
        ObjectNode item = pending.remove(state);
        if (item == null || code.isEmpty()) return failure(item, 400, "连接请求已失效或授权已取消");
        try {
            LinkedMultiValueMap<String, String> form = new LinkedMultiValueMap<>();
            form.add("grant_type", "authorization_code");
            form.add("client_id", configuration.required("DUOWEI_FEISHU_APP_ID"));
            form.add("client_secret", configuration.required("DUOWEI_FEISHU_APP_SECRET"));
            form.add("code", code);
            form.add("redirect_uri", configuration.required("DUOWEI_OAUTH_REDIRECT_URI"));
            form.add("code_verifier", item.path("verifier").asText());
            JsonNode token =
                    api.call(
                            "https://accounts.feishu.cn/oauth/v3/token",
                            HttpMethod.POST,
                            form,
                            null,
                            MediaType.APPLICATION_FORM_URLENCODED);
            String access = Protocol.required(token, "access_token");
            JsonNode user =
                    api.get("https://open.feishu.cn/open-apis/authen/v1/user_info", access)
                            .path("data");
            JsonNode permission =
                    api.get(
                            "https://open.feishu.cn/open-apis/drive/v1/permissions/"
                                    + FeishuClient.enc(item.path("baseToken").asText())
                                    + "/members/auth?type=bitable&action=edit",
                            access);
            if (!permission.path("data").path("auth_result").asBoolean())
                throw new SecurityException("当前用户没有多维表格编辑权限");
            ObjectNode session = Protocol.JSON.createObjectNode();
            session.put("principalId", Protocol.required(user, "open_id"));
            session.put("tenantKey", Protocol.required(user, "tenant_key"));
            session.put("baseToken", item.path("baseToken").asText());
            session.put("tableId", item.path("tableId").asText());
            session.put("canWrite", true);
            long lifetime = Math.min(7200000, token.path("expires_in").asLong() * 1000 - 30000);
            if (lifetime < 60000) throw new SecurityException("用户令牌有效期不足");
            session.put("expiresAt", System.currentTimeMillis() + lifetime);
            String id = random();
            sessions.put(id, session);
            String cookie =
                    COOKIE
                            + "="
                            + id
                            + "; Path=/; Max-Age="
                            + lifetime / 1000
                            + "; HttpOnly; Secure; SameSite=None";
            if (item.path("bridge").asBoolean())
                return ResponseEntity.status(303)
                        .header("Location", browser() + "/bridge")
                        .header("Set-Cookie", cookie)
                        .cacheControl(CacheControl.noStore())
                        .build();
            String nonce = random();
            String origin = item.path("origin").toString().replace("<", "\\u003c");
            return ResponseEntity.ok()
                    .header("Set-Cookie", cookie)
                    .header(
                            "Content-Security-Policy",
                            "default-src 'none'; script-src 'nonce-"
                                    + nonce
                                    + "'; frame-ancestors 'none'")
                    .contentType(MediaType.TEXT_HTML)
                    .cacheControl(CacheControl.noStore())
                    .body(
                            "<!doctype html><meta charset='utf-8'><p>连接成功，可以关闭此窗口。</p><script nonce='"
                                    + nonce
                                    + "'>if(window.opener)window.opener.postMessage({type:'duowei-print:oauth-connected'},"
                                    + origin
                                    + ");setTimeout(()=>window.close(),250)</script>");
        } catch (SecurityException error) {
            return failure(item, 403, error.getMessage());
        } catch (Exception error) {
            return failure(item, 502, "飞书连接失败，请重新连接");
        }
    }

    private ResponseEntity<?> failure(ObjectNode item, int status, String message) {
        String nonce = random();
        String origin = item == null ? "https://invalid.local" : item.path("origin").asText();
        ObjectNode payload = Protocol.JSON.createObjectNode();
        payload.put("type", "duowei-print:oauth-failed");
        payload.put("message", com.duowei.print.exception.SafeMessages.sanitize(message));
        String script =
                "if(window.opener)window.opener.postMessage("
                        + payload.toString().replace("<", "\\u003c")
                        + ","
                        + new TextNode(origin).toString().replace("<", "\\u003c")
                        + ");";
        return ResponseEntity.status(status)
                .contentType(MediaType.TEXT_HTML)
                .cacheControl(CacheControl.noStore())
                .header(
                        "Content-Security-Policy",
                        "default-src 'none'; script-src 'nonce-"
                                + nonce
                                + "'; frame-ancestors 'none'")
                .body(
                        "<!doctype html><meta charset='utf-8'><p>连接失败，请返回多维打印重新连接。</p><script nonce='"
                                + nonce
                                + "'>"
                                + script
                                + "</script>");
    }
}
