package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.duowei.print.integration.feishu.FeishuClient;
import com.duowei.print.service.oauth.OAuthService;
import org.junit.jupiter.api.Test;

class OAuthFailureTest {
    @Test
    void expiredStateReturnsSafeHtmlCallback() {
        FeishuClient api = mock(FeishuClient.class);
        org.springframework.http.ResponseEntity<?> result =
                new OAuthService(api, mock(com.duowei.print.config.AutomationConfiguration.class))
                        .callback("expired", "code");
        assertEquals(400, result.getStatusCodeValue());
        assertEquals("no-referrer", result.getHeaders().getFirst("Referrer-Policy"));
        assertEquals("nosniff", result.getHeaders().getFirst("X-Content-Type-Options"));
        assertTrue(result.getBody().toString().contains("duowei-print:oauth-failed"));
        assertTrue(
                result.getHeaders()
                        .getFirst("Content-Security-Policy")
                        .contains("frame-ancestors 'none'"));
        verifyNoInteractions(api);
    }

    @Test
    void connectionRequestProducesPkceAndStateIsSingleUse() throws Exception {
        FeishuClient api = mock(FeishuClient.class);
        com.duowei.print.config.AutomationConfiguration config =
                mock(com.duowei.print.config.AutomationConfiguration.class);
        when(config.allowedOrigins())
                .thenReturn(java.util.Collections.singleton("https://plugin.example"));
        when(config.required("DUOWEI_PUBLIC_AUTOMATION_BASE_URL"))
                .thenReturn("https://service.example/openapi/duowei-print");
        when(config.required("DUOWEI_FEISHU_APP_ID")).thenReturn("cli_test");
        when(config.required("DUOWEI_OAUTH_REDIRECT_URI"))
                .thenReturn("https://service.example/api/automation/oauth/callback");
        OAuthService oauth = new OAuthService(api, config);
        org.springframework.mock.web.MockHttpServletRequest request =
                new org.springframework.mock.web.MockHttpServletRequest();
        request.addHeader("Origin", "https://plugin.example");
        com.fasterxml.jackson.databind.node.ObjectNode draft =
                (com.fasterxml.jackson.databind.node.ObjectNode)
                        com.duowei.print.security.Protocol.JSON.readTree(
                                "{\"scope\":{\"baseToken\":\"base\",\"tableId\":\"table\"},\"template\":{}}");
        org.springframework.http.ResponseEntity<?> required = oauth.authorize(request, draft);
        assertEquals(401, required.getStatusCodeValue());
        String connect =
                ((com.fasterxml.jackson.databind.JsonNode) required.getBody())
                        .path("connectUrl")
                        .asText();
        String state = connect.substring(connect.indexOf("state=") + 6);
        String location = oauth.start(state).getHeaders().getFirst("Location");
        assertTrue(location.contains("code_challenge_method=S256"));
        assertTrue(location.contains("scope=bitable%3Aapp"));
        assertEquals("no-referrer", oauth.start(state).getHeaders().getFirst("Referrer-Policy"));
        assertEquals(400, oauth.callback(state, "").getStatusCodeValue());
        assertEquals(400, oauth.start(state).getStatusCodeValue());
        verifyNoInteractions(api);
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource({
        "true,7200",
        "false,7200",
        "\"true\",7200",
        "true,30",
        "true,1e20",
        "bridge,7200"
    })
    void successfulAuthorizationChecksEditPermissionAndSetsSecureSession(
            String permissionValue, String expiry) throws Exception {
        FeishuClient api = mock(FeishuClient.class);
        com.duowei.print.config.AutomationConfiguration config =
                mock(com.duowei.print.config.AutomationConfiguration.class);
        when(config.allowedOrigins())
                .thenReturn(java.util.Collections.singleton("https://plugin.example"));
        when(config.required("DUOWEI_PUBLIC_AUTOMATION_BASE_URL"))
                .thenReturn("https://service.example/openapi/duowei-print");
        when(config.required("DUOWEI_FEISHU_APP_ID")).thenReturn("cli_test");
        when(config.required("DUOWEI_FEISHU_APP_SECRET")).thenReturn("test-only");
        when(config.required("DUOWEI_OAUTH_REDIRECT_URI"))
                .thenReturn("https://service.example/api/automation/oauth/callback");
        OAuthService oauth = new OAuthService(api, config);
        org.springframework.mock.web.MockHttpServletRequest request =
                new org.springframework.mock.web.MockHttpServletRequest();
        boolean bridge = "bridge".equals(permissionValue);
        request.addHeader(
                "Origin", bridge ? " https://service.example " : " https://plugin.example ");
        if (bridge) request.addHeader("x-duowei-plugin-origin", " https://plugin.example ");
        com.fasterxml.jackson.databind.node.ObjectNode draft =
                (com.fasterxml.jackson.databind.node.ObjectNode)
                        com.duowei.print.security.Protocol.JSON.readTree(
                                "{\"scope\":{\"baseToken\":\"base\",\"tableId\":\"table\"},\"template\":{}}");
        String connect =
                ((com.fasterxml.jackson.databind.JsonNode)
                                oauth.authorize(request, draft).getBody())
                        .path("connectUrl")
                        .asText();
        String state = connect.substring(connect.indexOf("state=") + 6);
        when(api.call(contains("oauth/v3/token"), any(), any(), isNull(), any()))
                .thenReturn(
                        com.duowei.print.security.Protocol.JSON.readTree(
                                "{\"code\":0,\"access_token\":\"user-token\",\"expires_in\":"
                                        + expiry
                                        + "}"));
        when(api.get(contains("user_info"), eq("user-token")))
                .thenReturn(
                        com.duowei.print.security.Protocol.JSON.readTree(
                                "{\"data\":{\"open_id\":\"user\",\"tenant_key\":\"tenant\"}}"));
        when(api.get(contains("/members/auth?type=bitable&action=edit"), eq("user-token")))
                .thenReturn(
                        com.duowei.print.security.Protocol.JSON.readTree(
                                "{\"data\":{\"auth_result\":"
                                        + (bridge ? "true" : permissionValue)
                                        + "}}"));
        org.springframework.http.ResponseEntity<?> result = oauth.callback(state, "code");
        if (!"true".equals(permissionValue) && !bridge) {
            assertTrue(result.getStatusCodeValue() >= 400);
            assertNull(result.getHeaders().getFirst("Set-Cookie"));
            return;
        }
        assertEquals(bridge ? 303 : 200, result.getStatusCodeValue());
        assertEquals("no-referrer", result.getHeaders().getFirst("Referrer-Policy"));
        if (bridge)
            assertEquals(
                    "https://service.example/api/automation/bridge",
                    result.getHeaders().getFirst("Location"));
        String cookie = result.getHeaders().getFirst("Set-Cookie");
        assertTrue(cookie.contains("HttpOnly; Secure; SameSite=None"));
        if ("30".equals(expiry)) assertTrue(cookie.contains("Max-Age=60;"));
        if ("1e20".equals(expiry)) assertTrue(cookie.contains("Max-Age=7200;"));
        if (!bridge)
            assertTrue(result.getBody().toString().contains("duowei-print:oauth-connected"));
        byte[] signingKey = new byte[32];
        java.util.Arrays.fill(signingKey, (byte) 42);
        when(config.signingSecret("DUOWEI_REGISTRY_WRITE_SIGNING_SECRET_HEX"))
                .thenReturn(signingKey);
        String sessionId = cookie.substring(cookie.indexOf('=') + 1, cookie.indexOf(';'));
        request.setCookies(new javax.servlet.http.Cookie("__Host-duowei_oauth_session", sessionId));
        ((com.fasterxml.jackson.databind.node.ObjectNode) draft.path("scope"))
                .put("baseToken", " base ")
                .put("tableId", " table ");
        org.springframework.http.ResponseEntity<?> authorized = oauth.authorize(request, draft);
        assertEquals(200, authorized.getStatusCodeValue());
        com.fasterxml.jackson.databind.JsonNode payload =
                (com.fasterxml.jackson.databind.JsonNode) authorized.getBody();
        assertEquals("tenant", payload.path("body").path("scope").path("tenantKey").asText());
        assertFalse(draft.path("scope").has("tenantKey"));
        assertEquals(" base ", draft.path("scope").path("baseToken").asText());
        assertEquals("base", payload.path("body").path("scope").path("baseToken").asText());
        assertEquals("table", payload.path("body").path("scope").path("tableId").asText());
        com.fasterxml.jackson.databind.JsonNode claims =
                com.duowei.print.security.Protocol.verify(
                        payload.path("authorization").asText(),
                        "duowei-registry-v1",
                        "duowei-template-registry-write",
                        payload.path("body"),
                        signingKey);
        assertEquals("user", claims.path("principalId").asText());
        assertTrue(claims.path("canWrite").asBoolean());
        com.fasterxml.jackson.databind.node.ObjectNode otherScope = draft.deepCopy();
        ((com.fasterxml.jackson.databind.node.ObjectNode) otherScope.path("scope"))
                .put("tableId", "other-table");
        assertEquals(401, oauth.authorize(request, otherScope).getStatusCodeValue());
        request.removeHeader("Origin");
        request.addHeader("Origin", "https://evil.example");
        assertThrows(SecurityException.class, () -> oauth.authorize(request, draft));
        verify(api).get(contains("/members/auth?type=bitable&action=edit"), eq("user-token"));
        assertEquals(400, oauth.callback(state, "code").getStatusCodeValue());
    }
}
