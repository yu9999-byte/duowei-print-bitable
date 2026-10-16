package com.duowei.print.service.registry;

import com.duowei.print.repository.TemplateStore;
import com.duowei.print.security.Protocol;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;
import org.springframework.http.*;
import org.springframework.stereotype.Service;

@Service
public class RegistryService {
    private final TemplateStore store;
    private final com.duowei.print.config.AutomationConfiguration configuration;

    public RegistryService(
            TemplateStore store, com.duowei.print.config.AutomationConfiguration configuration) {
        this.store = store;
        this.configuration = configuration;
    }

    public ResponseEntity<?> execute(JsonNode body, String signature) {
        boolean read = body.has("operation");
        if (signature == null || signature.trim().isEmpty())
            throw new SecurityException("模板注册表请求缺少身份签名");
        if (read) {
            String op = body.path("operation").asText();
            if (!Arrays.asList("get", "list").contains(op))
                throw new IllegalArgumentException("读取操作无效");
            Protocol.verify(
                    signature,
                    "duowei-registry-read-v1",
                    "duowei-template-registry-read",
                    body,
                    configuration.signingSecret("DUOWEI_REGISTRY_READ_SIGNING_SECRET_HEX"));
            List<JsonNode> rows = store.read(body);
            ObjectNode result = Protocol.JSON.createObjectNode();
            if ("list".equals(op)) result.set("templates", Protocol.JSON.valueToTree(rows));
            else result.set("template", rows.isEmpty() ? NullNode.instance : rows.get(0));
            return ResponseEntity.ok(result);
        }
        JsonNode claims =
                Protocol.verify(
                        signature,
                        "duowei-registry-v1",
                        "duowei-template-registry-write",
                        body,
                        configuration.signingSecret("DUOWEI_REGISTRY_WRITE_SIGNING_SECRET_HEX"));
        if (!claims.path("canWrite").asBoolean()) throw new SecurityException("没有写入权限");
        for (String key : Arrays.asList("tenantKey", "baseToken", "tableId"))
            if (!Protocol.required(body.path("scope"), key).equals(claims.path(key).asText()))
                throw new SecurityException("作用域不一致");
        store.upsert(body);
        return ResponseEntity.noContent().build();
    }
}
