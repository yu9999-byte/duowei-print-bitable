package com.duowei.print;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.duowei.print.config.AutomationConfiguration;
import com.duowei.print.controller.AutomationController;
import com.duowei.print.integration.feishu.FeishuClient;
import com.duowei.print.service.event.EventService;
import com.duowei.print.service.job.BackgroundService;
import com.duowei.print.service.oauth.OAuthService;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class OAuthRouteTest {
    @Test
    void untrustedAuthorizationOriginUsesOriginalIdentityErrorProtocol() throws Exception {
        AutomationConfiguration config = mock(AutomationConfiguration.class);
        when(config.required("DUOWEI_PUBLIC_AUTOMATION_BASE_URL"))
                .thenReturn("https://service.example/openapi/duowei-print");
        when(config.allowedOrigins())
                .thenReturn(java.util.Collections.singleton("https://plugin.example"));
        OAuthService oauth = new OAuthService(mock(FeishuClient.class), config);
        MockMvc mvc =
                MockMvcBuilders.standaloneSetup(
                                new AutomationController(
                                        oauth,
                                        mock(BackgroundService.class),
                                        mock(EventService.class)))
                        .build();
        for (String base : new String[] {"/api/automation", "/openapi/duowei-print"}) {
            org.springframework.test.web.servlet.MvcResult result =
                    mvc.perform(
                                    post(base + "/registry-write-token")
                                            .header("Origin", "https://evil.example")
                                            .contentType(
                                                    org.springframework.http.MediaType
                                                            .APPLICATION_JSON)
                                            .content(
                                                    "{\"scope\":{\"baseToken\":\"base\",\"tableId\":\"table\"},\"template\":{}}"))
                            .andExpect(status().isUnauthorized())
                            .andExpect(jsonPath("$.code").value("IDENTITY_INVALID"))
                            .andReturn();
            org.junit.jupiter.api.Assertions.assertEquals(
                    com.duowei.print.security.Protocol.JSON
                            .readTree(result.getResponse().getContentAsString())
                            .path("traceId")
                            .asText(),
                    result.getResponse().getHeader("x-duowei-trace-id"));
        }
    }

    @Test
    void cancellationTakesPriorityOverCodeAndTrimsState() throws Exception {
        OAuthService oauth = mock(OAuthService.class);
        when(oauth.callback("state", ""))
                .thenReturn(org.springframework.http.ResponseEntity.badRequest().build());
        MockMvc mvc =
                MockMvcBuilders.standaloneSetup(
                                new AutomationController(
                                        oauth,
                                        mock(BackgroundService.class),
                                        mock(EventService.class)))
                        .build();
        mvc.perform(
                        get("/api/automation/oauth/callback")
                                .param("state", " state ")
                                .param("code", "code")
                                .param("error", "access_denied"))
                .andExpect(status().isBadRequest());
        verify(oauth).callback("state", "");
        verifyNoMoreInteractions(oauth);
    }

    @Test
    void missingStateReturnsFailurePageOnBothRouteFamilies() throws Exception {
        FeishuClient api = mock(FeishuClient.class);
        OAuthService oauth = new OAuthService(api, mock(AutomationConfiguration.class));
        MockMvc mvc =
                MockMvcBuilders.standaloneSetup(
                                new AutomationController(
                                        oauth,
                                        mock(BackgroundService.class),
                                        mock(EventService.class)))
                        .build();
        for (String base : new String[] {"/api/automation", "/openapi/duowei-print"}) {
            mvc.perform(get(base + "/oauth/start"))
                    .andExpect(status().isBadRequest())
                    .andExpect(
                            content()
                                    .string(
                                            org.hamcrest.Matchers.containsString(
                                                    "duowei-print:oauth-failed")));
            mvc.perform(get(base + "/oauth/callback"))
                    .andExpect(status().isBadRequest())
                    .andExpect(
                            content()
                                    .string(
                                            org.hamcrest.Matchers.containsString(
                                                    "duowei-print:oauth-failed")));
        }
        verifyNoInteractions(api);
    }
}
