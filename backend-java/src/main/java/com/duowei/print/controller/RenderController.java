package com.duowei.print.controller;

import com.duowei.print.integration.feishu.FeishuClient;
import com.duowei.print.security.Protocol;
import com.duowei.print.service.render.RenderService;
import com.fasterxml.jackson.databind.*;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
public class RenderController {
    private final com.duowei.print.service.render.RenderRequestService renderer;

    public RenderController(com.duowei.print.service.render.RenderRequestService renderer) {
        this.renderer = renderer;
    }

    @PostMapping({"/api/automation/render", "/openapi/duowei-print/render"})
    public ResponseEntity<?> render(
            @RequestHeader(value = "x-duowei-service-signature", defaultValue = "")
                    String signature,
            @RequestBody JsonNode body) {
        if (signature.trim().isEmpty())
            return error(401, "AUTH_REQUIRED", "authentication", "渲染请求缺少服务身份签名");
        try {
            RenderService.Artifact a;
            try {
                a = renderer.render(signature, body);
            } catch (IllegalStateException failure) {
                boolean timeout =
                        failure.getMessage() != null && failure.getMessage().contains("超时");
                return error(timeout ? 504 : 502, "RENDER_FAILED", "render", failure.getMessage());
            }
            return ResponseEntity.ok()
                    .header("x-duowei-trace-id", java.util.UUID.randomUUID().toString())
                    .contentLength(a.bytes.length)
                    .contentType(MediaType.parseMediaType(a.contentType))
                    .header("x-duowei-artifact-key", a.artifactKey)
                    .header("x-duowei-file-name", FeishuClient.enc(a.fileName))
                    .header("x-duowei-page-count", String.valueOf(a.pageCount))
                    .body(a.bytes);
        } catch (SecurityException invalid) {
            return error(401, "AUTH_INVALID", "authentication", invalid.getMessage());
        } catch (IllegalArgumentException invalid) {
            return error(400, "REQUEST_INVALID", "request", invalid.getMessage());
        }
    }

    @GetMapping(value = "/openapi/duowei-print/renderer", produces = "text/html;charset=UTF-8")
    public org.springframework.core.io.Resource page() {
        return new ClassPathResource("renderer.html");
    }

    private ResponseEntity<?> error(int status, String code, String stage, String message) {
        String trace = java.util.UUID.randomUUID().toString();
        com.fasterxml.jackson.databind.node.ObjectNode body = Protocol.JSON.createObjectNode();
        body.put("success", false);
        body.put("code", code);
        body.put("stage", stage);
        body.put("traceId", trace);
        body.put("message", com.duowei.print.exception.SafeMessages.sanitize(message));
        return ResponseEntity.status(status).header("x-duowei-trace-id", trace).body(body);
    }
}
