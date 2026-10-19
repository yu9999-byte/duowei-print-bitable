package com.duowei.print;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.duowei.print.controller.RegistryController;
import com.duowei.print.service.registry.RegistryService;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class RegistryContractTest {
    @Test
    void missingSignatureIsAuthenticationRequiredBeforeServiceExecution() throws Exception {
        RegistryService service = mock(RegistryService.class);
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new RegistryController(service)).build();
        mvc.perform(
                        post("/openapi/duowei-print/registry-write")
                                .contentType("application/json")
                                .content("{}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTH_REQUIRED"))
                .andExpect(header().exists("x-duowei-trace-id"));
        verifyNoInteractions(service);
    }

    @Test
    void invalidTemplateReturnsOriginalCodeAndRedactsCredentials() throws Exception {
        RegistryService service = mock(RegistryService.class);
        when(service.execute(any(), anyString()))
                .thenThrow(new IllegalArgumentException("Bearer private-token 模板无效"));
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new RegistryController(service)).build();
        mvc.perform(
                        post("/openapi/duowei-print/registry-write")
                                .header("x-duowei-service-signature", "signed")
                                .contentType("application/json")
                                .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("TEMPLATE_INVALID"))
                .andExpect(jsonPath("$.message").value("Bearer [已隐藏] 模板无效"))
                .andExpect(header().exists("x-duowei-trace-id"));
    }

    @Test
    void keepsHealthAndReadWriteBoundaries() throws Exception {
        RegistryService service = mock(RegistryService.class);
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new RegistryController(service)).build();
        mvc.perform(get("/openapi/duowei-print/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.protocolVersion").value(1));
        mvc.perform(
                        post("/openapi/duowei-print/registry-write")
                                .contentType("application/json")
                                .content("{\"operation\":\"list\"}"))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(jsonPath("$.code").value("WRITE_ONLY_ENDPOINT"))
                .andExpect(jsonPath("$.message").value("模板写入入口不允许读取"));
        mvc.perform(
                        post("/openapi/duowei-print/registry-read")
                                .contentType("application/json")
                                .content("{\"scope\":{}}"))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(jsonPath("$.code").value("READ_ONLY_ENDPOINT"))
                .andExpect(jsonPath("$.message").value("自动化公网入口只允许读取模板"));
        mvc.perform(
                        post("/openapi/duowei-print/registry-read")
                                .contentType("application/json")
                                .content("{\"operation\":\"other\"}"))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(jsonPath("$.code").value("READ_ONLY_ENDPOINT"))
                .andExpect(jsonPath("$.message").value("自动化公网入口只允许读取模板"));
        verifyNoInteractions(service);
    }
}
