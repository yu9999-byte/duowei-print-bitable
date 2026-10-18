package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.duowei.print.config.AutomationConfiguration;
import com.duowei.print.controller.AutomationController;
import com.duowei.print.integration.feishu.FeishuClient;
import com.duowei.print.repository.BackgroundJobRepository;
import com.duowei.print.security.Protocol;
import com.duowei.print.service.job.BackgroundService;
import com.duowei.print.service.render.RenderService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class OriginalBackgroundContractTest {
    @Test
    void matchesOriginalErrorsAndExistingTaskStatuses() throws Exception {
        for (JsonNode item :
                Protocol.JSON.readTree(
                        getClass().getResourceAsStream("/background-contracts.json"))) {
            BackgroundJobRepository jobs = mock(BackgroundJobRepository.class);
            AutomationConfiguration config = mock(AutomationConfiguration.class);
            when(config.workerInterval()).thenReturn(60000L);
            when(config.signingSecret(anyString())).thenReturn(new byte[32]);
            String key = item.path("body").path("taskKey").asText();
            boolean existing = item.path("existingStatus").isTextual();
            when(jobs.exists(key)).thenReturn(existing);
            String status = existing ? item.path("existingStatus").asText() : "queued";
            when(jobs.status(key)).thenReturn("failed".equals(status) ? "queued" : status);
            BackgroundService service =
                    new BackgroundService(
                            jobs, mock(FeishuClient.class), mock(RenderService.class), config);
            try {
                MockMvc mvc =
                        MockMvcBuilders.standaloneSetup(
                                        new AutomationController(null, service, null))
                                .addFilters(new com.duowei.print.config.RequestPolicy())
                                .build();
                MvcResult result =
                        mvc.perform(
                                        post("/openapi/duowei-print/background-jobs")
                                                .contentType("application/json")
                                                .header(
                                                        "x-duowei-tenant-access-token",
                                                        "isolated-token-long-enough")
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
                        (ObjectNode)
                                Protocol.JSON.readTree(
                                        result.getResponse().getContentAsByteArray());
                assertEquals(
                        actual.path("traceId").asText(),
                        result.getResponse().getHeader("x-duowei-trace-id"),
                        id);
                assertEquals(1, result.getResponse().getHeaders("x-duowei-trace-id").size(), id);
                actual.remove("traceId");
                assertEquals(item.path("expected").path("body"), actual, id);
                if (result.getResponse().getStatus() >= 400) verifyNoInteractions(jobs);
                else verify(jobs).createOrRetry(key, item.path("body").toString());
            } finally {
                service.close();
            }
        }
    }
}
