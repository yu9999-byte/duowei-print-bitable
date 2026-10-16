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
                .andExpect(jsonPath("$.code").value("WRITE_ONLY_ENDPOINT"));
        mvc.perform(
                        post("/openapi/duowei-print/registry-read")
                                .contentType("application/json")
                                .content("{\"scope\":{}}"))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(jsonPath("$.code").value("READ_ONLY_ENDPOINT"));
        verifyNoInteractions(service);
    }
}
