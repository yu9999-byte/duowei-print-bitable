package com.duowei.print.controller;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
public class RegistryController {
    private final com.duowei.print.service.registry.RegistryService service;

    public RegistryController(com.duowei.print.service.registry.RegistryService service) {
        this.service = service;
    }

    @GetMapping({"/api/automation/health", "/openapi/duowei-print/health"})
    public Map<String, Object> health() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("success", true);
        m.put("service", "多维打印自动化服务");
        m.put("protocolVersion", 1);
        return m;
    }

    @PostMapping(
            value = {
                "/api/automation/registry",
                "/openapi/duowei-print/registry-write",
                "/openapi/duowei-print/registry-read"
            },
            consumes = "application/json")
    public ResponseEntity<?> registry(
            javax.servlet.http.HttpServletRequest request,
            @RequestHeader(value = "x-duowei-service-signature", defaultValue = "")
                    String signature,
            @RequestBody JsonNode body) {
        boolean read = body.has("operation");
        String path = request.getRequestURI();
        if (path.endsWith("registry-write") && read)
            return ResponseEntity.status(405).body(error("WRITE_ONLY_ENDPOINT"));
        if (path.endsWith("registry-read") && !read)
            return ResponseEntity.status(405).body(error("READ_ONLY_ENDPOINT"));
        return service.execute(body, signature);
    }

    private Map<String, Object> error(String code) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("success", false);
        m.put("code", code);
        return m;
    }

    @ExceptionHandler({SecurityException.class, IllegalArgumentException.class})
    public ResponseEntity<?> error(RuntimeException e) {
        Map<String, Object> m =
                error(e instanceof SecurityException ? "AUTH_INVALID" : "REQUEST_INVALID");
        m.put("message", e.getMessage());
        m.put("traceId", UUID.randomUUID().toString());
        return ResponseEntity.status(e instanceof SecurityException ? 401 : 400).body(m);
    }
}
