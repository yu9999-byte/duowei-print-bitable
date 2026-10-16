package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;

import com.duowei.print.config.RequestPolicy;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.*;

class RequestPolicyTest {
    @Test
    void rejectsNonJsonAndOversizedRequestsBeforeController() throws Exception {
        RequestPolicy policy = new RequestPolicy();
        MockHttpServletRequest plain =
                new MockHttpServletRequest("POST", "/api/automation/registry");
        plain.setContentType("text/plain");
        MockHttpServletResponse response = new MockHttpServletResponse();
        policy.doFilter(plain, response, new MockFilterChain());
        assertEquals(415, response.getStatus());
        MockHttpServletRequest large =
                new MockHttpServletRequest("POST", "/api/automation/registry");
        large.setContentType("application/json");
        large.setContent(new byte[2 * 1024 * 1024 + 1]);
        response = new MockHttpServletResponse();
        policy.doFilter(large, response, new MockFilterChain());
        assertEquals(413, response.getStatus());
    }

    @Test
    void preservesJsonBodyForControllerAndAddsTraceHeader() throws Exception {
        RequestPolicy policy = new RequestPolicy();
        MockHttpServletRequest request =
                new MockHttpServletRequest("POST", "/api/automation/registry");
        request.setContentType("application/json");
        request.setContent("{\"ok\":true}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        MockHttpServletResponse response = new MockHttpServletResponse();
        policy.doFilter(
                request,
                response,
                (req, res) -> assertEquals("{\"ok\":true}", req.getReader().readLine()));
        assertNotNull(response.getHeader("X-Duowei-Trace-Id"));
    }
}
