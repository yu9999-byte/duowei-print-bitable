package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.duowei.print.config.AutomationConfiguration;
import com.duowei.print.controller.AutomationController;
import com.duowei.print.integration.feishu.FeishuClient;
import com.duowei.print.security.Protocol;
import com.duowei.print.service.oauth.OAuthService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class OriginalAuthorizationContractTest {
    @Test
    void matchesOriginalDraftAndUnconnectedIdentityResponses() throws Exception {
        Map<String, String> config = new HashMap<>();
        config.put(
                "DUOWEI_PUBLIC_AUTOMATION_BASE_URL",
                "https://service.example/openapi/duowei-print");
        config.put("DUOWEI_ALLOWED_ORIGINS", "https://plugin.example");
        FeishuClient api = mock(FeishuClient.class);
        org.springframework.test.web.servlet.MockMvc mvc =
                MockMvcBuilders.standaloneSetup(
                                new AutomationController(
                                        new OAuthService(api, new AutomationConfiguration(config)),
                                        null,
                                        null))
                        .build();
        for (JsonNode item :
                Protocol.JSON.readTree(
                        getClass().getResourceAsStream("/authorization-contracts.json"))) {
            org.springframework.test.web.servlet.MvcResult result =
                    mvc.perform(
                                    post("/api/automation/registry-write-token")
                                            .header("Origin", item.path("origin").asText())
                                            .contentType("application/json")
                                            .content(item.path("body").toString()))
                            .andReturn();
            assertEquals(
                    item.path("expected").path("status").intValue(),
                    result.getResponse().getStatus(),
                    item.path("id").asText());
            ObjectNode body =
                    (ObjectNode)
                            Protocol.JSON.readTree(result.getResponse().getContentAsByteArray());
            assertEquals(
                    body.path("traceId").asText(),
                    result.getResponse().getHeader("x-duowei-trace-id"));
            body.remove("traceId");
            if (body.has("connectUrl")) {
                String url = body.path("connectUrl").asText();
                assertTrue(url.matches(".*[?&]state=[A-Za-z0-9_-]+.*"));
                body.put("connectUrl", url.replaceAll("state=[A-Za-z0-9_-]+", "state=DYNAMIC"));
            }
            assertEquals(item.path("expected").path("body"), body, item.path("id").asText());
        }
        verifyNoInteractions(api);
    }
}
