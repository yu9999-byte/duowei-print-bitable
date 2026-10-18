package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.duowei.print.config.AutomationConfiguration;
import com.duowei.print.controller.RegistryController;
import com.duowei.print.repository.TemplateStore;
import com.duowei.print.security.Protocol;
import com.duowei.print.service.registry.RegistryService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class OriginalRegistryContractTest {
    @Test
    void matchesOriginalRegistryRequestErrors() throws Exception {
        TemplateStore store = mock(TemplateStore.class);
        AutomationConfiguration configuration = mock(AutomationConfiguration.class);
        when(configuration.signingSecret(anyString())).thenReturn(new byte[32]);
        when(store.read(any())).thenReturn(java.util.Collections.emptyList());
        MockMvc mvc =
                MockMvcBuilders.standaloneSetup(
                                new RegistryController(new RegistryService(store, configuration)))
                        .addFilters(new com.duowei.print.config.RequestPolicy())
                        .build();
        JsonNode cases =
                Protocol.JSON.readTree(getClass().getResourceAsStream("/registry-contracts.json"));
        for (JsonNode item : cases) {
            clearInvocations(store);
            MvcResult result =
                    mvc.perform(
                                    post("/api/automation/registry")
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
            ObjectNode actual =
                    result.getResponse().getContentAsByteArray().length == 0
                            ? null
                            : (ObjectNode)
                                    Protocol.JSON.readTree(
                                            result.getResponse().getContentAsByteArray());
            assertNotNull(result.getResponse().getHeader("x-duowei-trace-id"), id);
            assertEquals(1, result.getResponse().getHeaders("x-duowei-trace-id").size(), id);
            if (actual != null && actual.has("traceId")) {
                assertFalse(actual.path("traceId").asText().isEmpty(), id);
                assertEquals(
                        actual.path("traceId").asText(),
                        result.getResponse().getHeader("x-duowei-trace-id"),
                        id);
                actual.remove("traceId");
            }
            assertEquals(
                    item.path("expected").path("body"),
                    actual == null ? com.fasterxml.jackson.databind.node.NullNode.instance : actual,
                    id);
            if ("upsert".equals(item.path("storeOperation").asText()))
                verify(store).upsert(item.path("body"));
            else if (item.has("storeOperation")) verify(store).read(item.path("body"));
            else verifyNoInteractions(store);
            verifyNoMoreInteractions(store);
        }
    }
}
