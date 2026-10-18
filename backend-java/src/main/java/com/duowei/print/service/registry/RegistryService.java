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
            body = normalizeRead(body);
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
            if (!body.path("scope").path(key).isTextual()
                    || !body.path("scope").path(key).textValue().equals(claims.path(key).asText()))
                throw new SecurityException("作用域不一致");
        JsonNode template = body.path("template");
        for (String key : Arrays.asList("id", "revision", "name")) Protocol.required(template, key);
        Protocol.safeSnapshot(template.path("snapshot"));
        if (!template.path("referencedFieldIds").isArray())
            throw new IllegalArgumentException("模板字段引用必须是数组");
        for (JsonNode field : template.path("referencedFieldIds"))
            if (!field.isTextual()) throw new IllegalArgumentException("模板字段引用无效");
        store.upsert(body);
        return ResponseEntity.noContent().build();
    }

    private JsonNode normalizeRead(JsonNode input) {
        ObjectNode result = Protocol.JSON.createObjectNode();
        JsonNode rawScope = input.path("scope");
        if (!rawScope.isObject()) throw new IllegalArgumentException("模板注册表读取作用域无效");
        for (String key : Arrays.asList("tenantKey", "baseToken", "tableId")) {
            if (!rawScope.path(key).isTextual() || rawScope.path(key).textValue().trim().isEmpty())
                throw new IllegalArgumentException("模板注册表读取作用域无效");
        }
        String operation =
                input.path("operation").isTextual() ? input.path("operation").textValue() : "";
        if (!Arrays.asList("get", "list").contains(operation))
            throw new IllegalArgumentException("模板注册表读取操作无效");
        result.put("operation", operation);
        ObjectNode scope = result.putObject("scope");
        for (String key : Arrays.asList("tenantKey", "baseToken", "tableId"))
            scope.put(key, Protocol.required(input.path("scope"), key));
        if ("get".equals(operation)) {
            JsonNode rawSelection = input.path("selection");
            if (!rawSelection.isObject()
                    || !rawSelection.path("id").isTextual()
                    || rawSelection.path("id").asText().trim().isEmpty()
                    || !rawSelection.path("revision").isTextual()
                    || rawSelection.path("revision").asText().trim().isEmpty())
                throw new IllegalArgumentException("模板注册表模板选择无效");
            ObjectNode selection = result.putObject("selection");
            selection.put("id", Protocol.required(input.path("selection"), "id"));
            selection.put("revision", Protocol.required(input.path("selection"), "revision"));
        }
        return result;
    }
}
