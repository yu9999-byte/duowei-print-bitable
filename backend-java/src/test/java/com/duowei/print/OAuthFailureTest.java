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
        when(config.required("DUOWEI_ALLOWED_ORIGINS")).thenReturn("https://plugin.example");
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
        assertEquals(400, oauth.callback(state, "").getStatusCodeValue());
        assertEquals(400, oauth.start(state).getStatusCodeValue());
        verifyNoInteractions(api);
    }

    @Test
    void successfulAuthorizationChecksEditPermissionAndSetsSecureSession() throws Exception {
        FeishuClient api = mock(FeishuClient.class);
        com.duowei.print.config.AutomationConfiguration config =
                mock(com.duowei.print.config.AutomationConfiguration.class);
        when(config.required("DUOWEI_ALLOWED_ORIGINS")).thenReturn("https://plugin.example");
        when(config.required("DUOWEI_PUBLIC_AUTOMATION_BASE_URL"))
                .thenReturn("https://service.example/openapi/duowei-print");
        when(config.required("DUOWEI_FEISHU_APP_ID")).thenReturn("cli_test");
        when(config.required("DUOWEI_FEISHU_APP_SECRET")).thenReturn("test-only");
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
        String connect =
                ((com.fasterxml.jackson.databind.JsonNode)
                                oauth.authorize(request, draft).getBody())
                        .path("connectUrl")
                        .asText();
        String state = connect.substring(connect.indexOf("state=") + 6);
        when(api.call(contains("oauth/v3/token"), any(), any(), isNull(), any()))
                .thenReturn(
                        com.duowei.print.security.Protocol.JSON.readTree(
                                "{\"code\":0,\"access_token\":\"user-token\",\"expires_in\":7200}"));
        when(api.get(contains("user_info"), eq("user-token")))
                .thenReturn(
                        com.duowei.print.security.Protocol.JSON.readTree(
                                "{\"data\":{\"open_id\":\"user\",\"tenant_key\":\"tenant\"}}"));
        when(api.get(contains("/members/auth?type=bitable&action=edit"), eq("user-token")))
                .thenReturn(
                        com.duowei.print.security.Protocol.JSON.readTree(
                                "{\"data\":{\"auth_result\":true}}"));
        org.springframework.http.ResponseEntity<?> result = oauth.callback(state, "code");
        assertEquals(200, result.getStatusCodeValue());
        String cookie = result.getHeaders().getFirst("Set-Cookie");
        assertTrue(cookie.contains("HttpOnly; Secure; SameSite=None"));
        assertTrue(result.getBody().toString().contains("duowei-print:oauth-connected"));
        verify(api).get(contains("/members/auth?type=bitable&action=edit"), eq("user-token"));
        assertEquals(400, oauth.callback(state, "code").getStatusCodeValue());
    }
}
