package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.duowei.print.config.AutomationConfiguration;
import com.duowei.print.controller.RenderController;
import com.duowei.print.security.Protocol;
import com.duowei.print.service.render.RenderCache;
import com.duowei.print.service.render.RenderRequestService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class OriginalRenderContractTest {
    @Test
    void matchesErrorsCapturedFromOriginalHttpHandler() throws Exception {
        RenderCache cache = mock(RenderCache.class);
        AutomationConfiguration configuration = mock(AutomationConfiguration.class);
        MockMvc mvc =
                MockMvcBuilders.standaloneSetup(
                                new RenderController(
                                        new RenderRequestService(cache, configuration)))
                        .build();
        JsonNode cases =
                Protocol.JSON.readTree(getClass().getResourceAsStream("/render-contracts.json"));
        for (JsonNode item : cases) {
            MvcResult result =
                    mvc.perform(
                                    post("/openapi/duowei-print/render")
                                            .contentType("application/json")
                                            .header(
                                                    "x-duowei-service-signature",
                                                    item.path("signature").asText())
                                            .content(item.path("body").toString()))
                            .andReturn();
            String id = item.path("id").asText();
            assertEquals(
                    item.path("expected").path("status").intValue(),
                    result.getResponse().getStatus(),
                    id);
            ObjectNode body =
                    (ObjectNode)
                            Protocol.JSON.readTree(result.getResponse().getContentAsByteArray());
            assertFalse(body.path("traceId").asText().isEmpty(), id);
            assertEquals(
                    body.path("traceId").asText(),
                    result.getResponse().getHeader("x-duowei-trace-id"),
                    id);
            body.remove("traceId");
            assertEquals(item.path("expected").path("body"), body, id);
        }
        verifyNoInteractions(cache);
    }
}
