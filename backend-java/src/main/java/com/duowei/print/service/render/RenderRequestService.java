package com.duowei.print.service.render;

import com.duowei.print.config.AutomationConfiguration;
import com.duowei.print.security.Protocol;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Service;

/** Authenticates artifact requests before invoking the shared rendering cache. */
@Service
public class RenderRequestService {
    private final RenderCache renderer;
    private final AutomationConfiguration configuration;

    public RenderRequestService(RenderCache renderer, AutomationConfiguration configuration) {
        this.renderer = renderer;
        this.configuration = configuration;
    }

    public RenderService.Artifact render(String signature, JsonNode body) {
        body = normalize(body);
        JsonNode claims =
                Protocol.verify(
                        signature,
                        "duowei-renderer-v1",
                        "duowei-renderer",
                        body,
                        configuration.signingSecret("DUOWEI_RENDERER_SIGNING_SECRET_HEX"));
        if (!Protocol.required(body, "artifactKey").equals(claims.path("artifactKey").asText())) {
            throw new SecurityException("产物键不一致");
        }
        return renderer.render(body);
    }

    public static JsonNode normalize(JsonNode body) {
        if (!body.isObject()
                || !body.path("template").isObject()
                || !body.path("output").isObject()
                || !body.path("values").isObject()) {
            throw new IllegalArgumentException("渲染请求无效");
        }
        JsonNode output = body.path("output");
        String type = output.path("type").isTextual() ? output.path("type").textValue() : "";
        if (!("pdf".equals(type) && output.path("pageLimit").isNull())
                && !("png".equals(type)
                        && output.path("pageLimit").isNumber()
                        && output.path("pageLimit").doubleValue() == 1.0)) {
            throw new IllegalArgumentException("自动化输出类型或页数无效");
        }
        Protocol.safeSnapshot(body.path("template").path("snapshot"));
        Protocol.safeSnapshot(body.path("values"));
        com.fasterxml.jackson.databind.node.ObjectNode result = Protocol.JSON.createObjectNode();
        result.put("artifactKey", Protocol.required(body, "artifactKey"));
        com.fasterxml.jackson.databind.node.ObjectNode template = result.putObject("template");
        template.put("id", Protocol.required(body.path("template"), "id"));
        template.put("revision", Protocol.required(body.path("template"), "revision"));
        template.set("snapshot", body.path("template").path("snapshot").deepCopy());
        result.set("values", body.path("values").deepCopy());
        com.fasterxml.jackson.databind.node.ObjectNode normalizedOutput =
                result.putObject("output");
        normalizedOutput.put("type", type);
        if ("png".equals(type)) normalizedOutput.put("pageLimit", 1);
        else normalizedOutput.putNull("pageLimit");
        return result;
    }
}
