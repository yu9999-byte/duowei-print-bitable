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
    public ResponseEntity<?> authorize(HttpServletRequest request, @RequestBody ObjectNode body) {
        return oauth.authorize(request, body);
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
            @RequestBody ObjectNode body) {
        return background.submit(signature, token, body);
    }

    @PostMapping("/openapi/duowei-print/events")
    public ResponseEntity<?> event(@RequestBody JsonNode body) {
        return events.event(body);
    }
}
