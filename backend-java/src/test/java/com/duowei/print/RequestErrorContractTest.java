package com.duowei.print;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.duowei.print.controller.RegistryController;
import com.duowei.print.exception.ApiErrors;
import com.duowei.print.service.registry.RegistryService;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class RequestErrorContractTest {
    @Test
    void preservesClientErrorStatusesAndTraceHeaders() throws Exception {
        RegistryService service = mock(RegistryService.class);
        MockMvc mvc =
                MockMvcBuilders.standaloneSetup(new RegistryController(service))
                        .setControllerAdvice(new ApiErrors())
                        .build();
        mvc.perform(
                        post("/openapi/duowei-print/registry-read")
                                .contentType("application/json")
                                .content("{"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("JSON_INVALID"))
                .andExpect(header().exists("x-duowei-trace-id"));
        mvc.perform(get("/openapi/duowei-print/registry-read"))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(jsonPath("$.code").value("METHOD_NOT_ALLOWED"));
        mvc.perform(
                        post("/openapi/duowei-print/registry-read")
                                .contentType("text/plain")
                                .content("{}"))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.code").value("CONTENT_TYPE_INVALID"));
        verifyNoInteractions(service);
    }
}
