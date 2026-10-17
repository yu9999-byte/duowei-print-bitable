package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;

import com.duowei.print.config.AutomationConfiguration;
import com.duowei.print.config.RequestPolicy;
import java.util.Collections;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class RendererAccessTest {
    @ParameterizedTest
    @ValueSource(strings = {"", "Bearer wrong", "Bearer test-only"})
    void rendererRequiresConfiguredServiceCredential(String authorization) throws Exception {
        RequestPolicy policy =
                new RequestPolicy(
                        new AutomationConfiguration(
                                Collections.singletonMap(
                                        "DUOWEI_SERVICE_AUTHORIZATION", "Bearer test-only")));
        MockHttpServletRequest request =
                new MockHttpServletRequest("GET", "/openapi/duowei-print/renderer");
        request.addHeader("Authorization", authorization);
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean reached = new AtomicBoolean();
        policy.doFilter(request, response, (req, res) -> reached.set(true));
        boolean valid = "Bearer test-only".equals(authorization);
        assertEquals(valid, reached.get());
        assertEquals(valid ? 200 : 401, response.getStatus());
    }
}
