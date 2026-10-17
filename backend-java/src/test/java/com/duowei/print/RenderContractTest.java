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
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(
            strings = {"/api/automation/render", "/openapi/duowei-print/render"})
    void renderTimeoutReturnsGatewayTimeoutWithTrace(String path) throws Exception {
        RenderRequestService renderer = mock(RenderRequestService.class);
        when(renderer.render(anyString(), any()))
                .thenThrow(new IllegalStateException("生成文件超时，请稍后重试"));
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new RenderController(renderer)).build();
        mvc.perform(
                        post(path)
                                .header("x-duowei-service-signature", "test-signature")
                                .contentType("application/json")
                                .content("{}"))
                .andExpect(status().isGatewayTimeout())
                .andExpect(jsonPath("$.code").value("RENDER_FAILED"))
                .andExpect(jsonPath("$.stage").value("render"))
                .andExpect(header().exists("x-duowei-trace-id"));
    }

    @Test
    void successfulRenderPreservesBytesAndArtifactHeaders() throws Exception {
        RenderRequestService renderer = mock(RenderRequestService.class);
        com.duowei.print.service.render.RenderService.Artifact artifact =
                new com.duowei.print.service.render.RenderService.Artifact();
        artifact.bytes = "%PDF-test".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        artifact.contentType = "application/pdf";
        artifact.fileName = "发货单.pdf";
        artifact.artifactKey = "duowei:v1:test";
        artifact.pageCount = 2;
        when(renderer.render(anyString(), any())).thenReturn(artifact);
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new RenderController(renderer)).build();
        mvc.perform(
                        post("/openapi/duowei-print/render")
                                .header("x-duowei-service-signature", "test-signature")
                                .contentType("application/json")
                                .content("{}"))
                .andExpect(status().isOk())
                .andExpect(content().bytes(artifact.bytes))
                .andExpect(content().contentType("application/pdf"))
                .andExpect(header().string("x-duowei-artifact-key", artifact.artifactKey))
                .andExpect(header().string("x-duowei-page-count", "2"))
                .andExpect(
                        header().string("x-duowei-file-name", "%E5%8F%91%E8%B4%A7%E5%8D%95.pdf"));
    }

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
