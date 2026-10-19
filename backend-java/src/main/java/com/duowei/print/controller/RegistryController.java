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
        String path = request.getRequestURI();
        boolean publicRead =
                body.path("operation").isTextual()
                        && Arrays.asList("get", "list")
                                .contains(body.path("operation").textValue());
        if (path.endsWith("registry-write") && publicRead)
            return directionFailure("WRITE_ONLY_ENDPOINT", "模板写入入口不允许读取");
        if (path.endsWith("registry-read") && !publicRead)
            return directionFailure("READ_ONLY_ENDPOINT", "自动化公网入口只允许读取模板");
        if (signature.trim().isEmpty()) return failure(401, "AUTH_REQUIRED", "模板注册表请求缺少身份签名");
        return service.execute(body, signature);
    }

    private ResponseEntity<?> directionFailure(String code, String message) {
        Map<String, Object> result = error(code);
        result.put("message", message);
        return ResponseEntity.status(405).body(result);
    }

    private Map<String, Object> error(String code) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("success", false);
        m.put("code", code);
        return m;
    }

    @ExceptionHandler({SecurityException.class, IllegalArgumentException.class})
    public ResponseEntity<?> error(RuntimeException e) {
        boolean authentication =
                e instanceof SecurityException
                        || java.util.regex.Pattern.compile("身份|签名|过期|写入权限|作用域")
                                .matcher(String.valueOf(e.getMessage()))
                                .find();
        return failure(
                authentication ? 401 : 400,
                authentication ? "AUTH_INVALID" : "TEMPLATE_INVALID",
                e.getMessage());
    }

    private ResponseEntity<?> failure(int status, String code, String message) {
        Map<String, Object> m = error(code);
        m.put("message", com.duowei.print.exception.SafeMessages.sanitize(message));
        String trace = UUID.randomUUID().toString();
        m.put("traceId", trace);
        return ResponseEntity.status(status).header("x-duowei-trace-id", trace).body(m);
    }
}
