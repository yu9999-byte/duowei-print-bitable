package com.duowei.print.service.event;

import com.duowei.print.security.Protocol;
import com.fasterxml.jackson.databind.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@org.springframework.stereotype.Service
public class EventService {
    private final com.duowei.print.repository.AppTicketRepository tickets;
    private final com.duowei.print.config.AutomationConfiguration configuration;

    public EventService(
            com.duowei.print.repository.AppTicketRepository tickets,
            com.duowei.print.config.AutomationConfiguration configuration) {
        this.tickets = tickets;
        this.configuration = configuration;
    }

    public ResponseEntity<?> event(JsonNode body) {
        if (body.path("encrypt").isTextual())
            return ResponseEntity.badRequest()
                    .body(Collections.singletonMap("code", "ENCRYPTED_EVENT_NOT_CONFIGURED"));
        if (!MessageDigest.isEqual(
                body.path("token").asText().getBytes(StandardCharsets.UTF_8),
                configuration
                        .required("DUOWEI_EVENT_VERIFICATION_TOKEN")
                        .getBytes(StandardCharsets.UTF_8)))
            return ResponseEntity.status(401)
                    .body(Collections.singletonMap("code", "VERIFICATION_FAILED"));
        if ("url_verification".equals(body.path("type").asText())
                && body.path("challenge").isTextual())
            return ResponseEntity.ok(
                    Collections.singletonMap("challenge", body.path("challenge").textValue()));
        JsonNode event = body.path("event");
        if ("app_ticket".equals(event.path("type").asText())) {
            if (!configuration
                            .required("DUOWEI_FEISHU_APP_ID")
                            .equals(event.path("app_id").asText())
                    || !event.path("app_ticket").isTextual()
                    || event.path("app_ticket").asText().trim().isEmpty())
                return ResponseEntity.badRequest()
                        .body(Collections.singletonMap("code", "APP_TICKET_INVALID"));
            tickets.save(event.path("app_id").asText(), Protocol.required(event, "app_ticket"));
        }
        return ResponseEntity.ok(Collections.singletonMap("code", 0));
    }
}
