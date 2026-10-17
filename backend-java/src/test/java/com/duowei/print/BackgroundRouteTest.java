package com.duowei.print;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.duowei.print.controller.AutomationController;
import com.duowei.print.service.job.BackgroundService;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class BackgroundRouteTest {
    @Test
    void invalidSignatureReturnsUnauthorizedAndMatchingTrace() throws Exception {
        BackgroundService service = mock(BackgroundService.class);
        when(service.submit(anyString(), anyString(), any()))
                .thenThrow(new SecurityException("Bearer private-token 签名无效"));
        MockMvc mvc =
                MockMvcBuilders.standaloneSetup(new AutomationController(null, service, null))
                        .build();
        org.springframework.test.web.servlet.MvcResult result =
                mvc.perform(
                                post("/openapi/duowei-print/background-jobs")
                                        .header(
                                                "x-duowei-tenant-access-token",
                                                "test-credential-long-enough")
                                        .header("x-duowei-service-signature", "invalid")
                                        .contentType("application/json")
                                        .content("{}"))
                        .andExpect(status().isUnauthorized())
                        .andExpect(jsonPath("$.code").value("AUTH_INVALID"))
                        .andExpect(jsonPath("$.message").value("Bearer [已隐藏] 签名无效"))
                        .andReturn();
        com.fasterxml.jackson.databind.JsonNode body =
                com.duowei.print.security.Protocol.JSON.readTree(
                        result.getResponse().getContentAsByteArray());
        org.junit.jupiter.api.Assertions.assertEquals(
                body.path("traceId").asText(), result.getResponse().getHeader("x-duowei-trace-id"));
    }

    @Test
    void missingTenantCredentialDoesNotReachService() throws Exception {
        BackgroundService service = mock(BackgroundService.class);
        MockMvc mvc =
                MockMvcBuilders.standaloneSetup(new AutomationController(null, service, null))
                        .build();
        mvc.perform(
                        post("/openapi/duowei-print/background-jobs")
                                .contentType("application/json")
                                .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("TENANT_TOKEN_REQUIRED"));
        verifyNoInteractions(service);
    }

    @Test
    void invalidJobReturnsJobProtocolAndRedactsCredentials() throws Exception {
        BackgroundService service = mock(BackgroundService.class);
        when(service.submit(anyString(), anyString(), any()))
                .thenThrow(new IllegalArgumentException("Bearer secret 任务无效"));
        MockMvc mvc =
                MockMvcBuilders.standaloneSetup(new AutomationController(null, service, null))
                        .build();
        mvc.perform(
                        post("/openapi/duowei-print/background-jobs")
                                .header(
                                        "x-duowei-tenant-access-token",
                                        "test-credential-long-enough")
                                .contentType("application/json")
                                .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("JOB_INVALID"))
                .andExpect(jsonPath("$.message").value("Bearer [已隐藏] 任务无效"))
                .andExpect(header().exists("x-duowei-trace-id"));
    }
}
