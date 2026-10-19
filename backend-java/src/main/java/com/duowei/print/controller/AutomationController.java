package com.duowei.print.controller;

import com.duowei.print.service.event.EventService;
import com.duowei.print.service.job.BackgroundService;
import com.duowei.print.service.oauth.OAuthService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import javax.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
public class AutomationController {
    private final OAuthService oauth;
    private final BackgroundService background;
    private final EventService events;

    public AutomationController(
            OAuthService oauth, BackgroundService background, EventService events) {
        this.oauth = oauth;
        this.background = background;
        this.events = events;
    }

    @PostMapping({
        "/api/automation/registry-write-token",
        "/openapi/duowei-print/registry-write-token"
    })
    public ResponseEntity<?> authorize(HttpServletRequest request, @RequestBody JsonNode body) {
        if (!validDraft(body)) return jobFailure(400, "REQUEST_INVALID", "模板同步授权请求无效");
        try {
            return oauth.authorize(request, (ObjectNode) body);
        } catch (SecurityException error) {
            return jobFailure(401, "IDENTITY_INVALID", error.getMessage());
        }
    }

    private boolean validDraft(JsonNode body) {
        if (body == null
                || !body.isObject()
                || body.size() != 2
                || !body.path("template").isObject()) return false;
        JsonNode scope = body.path("scope");
        if (!scope.isObject() || scope.size() != 2) return false;
        for (String key : new String[] {"baseToken", "tableId"})
            if (!scope.path(key).isTextual()
                    || com.duowei.print.security.Protocol.trimJavaScript(
                                    scope.path(key).textValue())
                            .isEmpty()) return false;
        return true;
    }

    @GetMapping({"/api/automation/oauth/start", "/openapi/duowei-print/oauth/start"})
    public ResponseEntity<?> start(@RequestParam(defaultValue = "") String state) {
        return oauth.start(state.trim());
    }

    @GetMapping({"/api/automation/oauth/callback", "/openapi/duowei-print/oauth/callback"})
    public ResponseEntity<?> callback(
            @RequestParam(defaultValue = "") String state,
            @RequestParam(defaultValue = "") String code,
            @RequestParam(defaultValue = "") String error) {
        return oauth.callback(state.trim(), error.isEmpty() ? code.trim() : "");
    }

    @PostMapping("/openapi/duowei-print/background-jobs")
    public ResponseEntity<?> submit(
            @RequestHeader(value = "x-duowei-service-signature", defaultValue = "")
                    String signature,
            @RequestHeader(value = "x-duowei-tenant-access-token", defaultValue = "") String token,
            @RequestBody JsonNode body) {
        if (token.trim().length() < 20)
            return jobFailure(400, "TENANT_TOKEN_REQUIRED", "后台任务缺少当前自动化的临时租户凭证");
        try {
            if (body == null || !body.isObject()) throw new IllegalArgumentException("后台任务请求必须是对象");
            return background.submit(signature, token, (ObjectNode) body);
        } catch (SecurityException error) {
            return jobFailure(401, "AUTH_INVALID", error.getMessage());
        } catch (IllegalArgumentException error) {
            return jobFailure(400, "JOB_INVALID", error.getMessage());
        }
    }

    private ResponseEntity<?> jobFailure(int status, String code, String message) {
        ObjectNode result = com.duowei.print.security.Protocol.JSON.createObjectNode();
        String trace = java.util.UUID.randomUUID().toString();
        result.put("success", false)
                .put("code", code)
                .put("message", com.duowei.print.exception.SafeMessages.sanitize(message))
                .put("traceId", trace);
        return ResponseEntity.status(status).header("x-duowei-trace-id", trace).body(result);
    }

    @PostMapping("/openapi/duowei-print/events")
    public ResponseEntity<?> event(@RequestBody JsonNode body) {
        return events.event(body);
    }
}
