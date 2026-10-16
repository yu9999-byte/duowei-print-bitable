package com.duowei.print.controller;

import com.duowei.print.security.Protocol;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.*;
import org.springframework.util.StreamUtils;
import org.springframework.web.bind.annotation.*;

@RestController
public class BridgeController {
    private final com.duowei.print.config.AutomationConfiguration configuration;

    public BridgeController(com.duowei.print.config.AutomationConfiguration configuration) {
        this.configuration = configuration;
    }

    @GetMapping(value = "/api/automation/bridge", produces = "text/html;charset=UTF-8")
    public ResponseEntity<String> bridge() throws Exception {
        String base =
                configuration
                        .required("DUOWEI_PUBLIC_AUTOMATION_BASE_URL")
                        .replaceAll("/+$", "")
                        .replace("/openapi/duowei-print", "/api/automation");
        String nonce = UUID.randomUUID().toString();
        String script;
        try (java.io.InputStream in = new ClassPathResource("bridge.js").getInputStream()) {
            script = StreamUtils.copyToString(in, StandardCharsets.UTF_8);
        }
        script =
                script.replace(
                                "__ALLOWED_ORIGINS__",
                                Protocol.JSON.writeValueAsString(
                                        Arrays.asList(
                                                configuration
                                                        .required("DUOWEI_ALLOWED_ORIGINS")
                                                        .split(","))))
                        .replace(
                                "__AUTHORIZATION_URL__",
                                Protocol.JSON.writeValueAsString(base + "/registry-write-token"))
                        .replace(
                                "__REGISTRY_URL__",
                                Protocol.JSON.writeValueAsString(base + "/registry"))
                        .replace(
                                "__OAUTH_START_PATH__",
                                Protocol.JSON.writeValueAsString(
                                        java.net.URI.create(base).getPath() + "/oauth/start"));
        script = script.replace("</script", "<\\/script");
        return ResponseEntity.ok()
                .contentType(MediaType.TEXT_HTML)
                .cacheControl(CacheControl.noStore())
                .header(
                        "Content-Security-Policy",
                        "default-src 'none'; script-src 'nonce-"
                                + nonce
                                + "'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
                .header("Referrer-Policy", "no-referrer")
                .header("X-Content-Type-Options", "nosniff")
                .body(
                        "<!doctype html><meta charset='utf-8'><title>连接多维打印自动化</title><h1>多维打印自动化</h1><p id='status'>正在初始化连接…</p><script nonce='"
                                + nonce
                                + "'>"
                                + script
                                + "</script>");
    }
}
