package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;

import com.duowei.print.config.AutomationConfiguration;
import com.duowei.print.controller.BridgeController;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

class BridgeContractTest {
    @Test
    void rendersScopedEndpointsOriginsAndNoncePolicy() throws Exception {
        Map<String, String> values = new HashMap<>();
        values.put(
                "DUOWEI_PUBLIC_AUTOMATION_BASE_URL",
                "https://service.example/app/app_x/openapi/duowei-print");
        values.put("DUOWEI_ALLOWED_ORIGINS", " https://record.example ,https://second.example/");
        ResponseEntity<String> response =
                new BridgeController(new AutomationConfiguration(values)).bridge();
        String html = response.getBody();
        assertTrue(html.contains("https://record.example"));
        assertFalse(html.contains(" https://record.example "));
        assertTrue(html.contains("api/automation/registry-write-token"));
        assertTrue(html.contains("api/automation/oauth/start"));
        assertTrue(html.contains("allowedOrigins.has(event.origin)"));
        assertTrue(html.contains("event.source !== window.opener"));
        assertTrue(html.contains("sessionStorage.setItem(pendingKey"));
        assertTrue(html.contains("duowei-print:bridge-result"));
        assertFalse(html.contains("__ALLOWED_ORIGINS__"));
        String policy = response.getHeaders().getFirst("Content-Security-Policy");
        assertTrue(policy.contains("connect-src 'self'"));
        assertTrue(policy.contains("frame-ancestors 'none'"));
        String nonce = policy.split("nonce-")[1].split("'")[0];
        assertTrue(html.contains("nonce='" + nonce + "'"));
        assertEquals("no-store", response.getHeaders().getCacheControl());
    }

    @Test
    void rejectsPathBearingOrigin() {
        Map<String, String> values = new HashMap<>();
        values.put(
                "DUOWEI_PUBLIC_AUTOMATION_BASE_URL",
                "https://service.example/openapi/duowei-print");
        values.put("DUOWEI_ALLOWED_ORIGINS", "https://record.example/path");
        assertThrows(
                IllegalStateException.class,
                () -> new BridgeController(new AutomationConfiguration(values)).bridge());
    }
}
