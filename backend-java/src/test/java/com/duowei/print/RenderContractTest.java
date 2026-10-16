package com.duowei.print;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.duowei.print.controller.RenderController;
import com.duowei.print.service.render.RenderRequestService;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class RenderContractTest {
    @Test
    void missingSignatureReturnsOriginalAuthenticationProtocol() throws Exception {
        RenderRequestService renderer = mock(RenderRequestService.class);
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new RenderController(renderer)).build();
        mvc.perform(
                        post("/openapi/duowei-print/render")
                                .contentType("application/json")
                                .content("{}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTH_REQUIRED"))
                .andExpect(jsonPath("$.stage").value("authentication"))
                .andExpect(header().exists("x-duowei-trace-id"));
        verifyNoInteractions(renderer);
    }
}
