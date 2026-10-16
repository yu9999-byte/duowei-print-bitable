package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;

import com.duowei.print.integration.feishu.FeishuClient;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

class FeishuResponseTest {
    @org.junit.jupiter.api.Test
    void rejectsOAuthErrorEvenWhenHttpStatusIsSuccessful() {
        FeishuClient client = new FeishuClient();
        RestTemplate http = (RestTemplate) ReflectionTestUtils.getField(client, "http");
        MockRestServiceServer server = MockRestServiceServer.bindTo(http).build();
        String url = "https://accounts.feishu.cn/oauth/v3/token";
        server.expect(requestTo(url))
                .andRespond(
                        withSuccess(
                                "{\"error\":\"invalid_grant\",\"error_description\":\"expired\"}",
                                MediaType.APPLICATION_JSON));
        assertThrows(IllegalStateException.class, () -> client.get(url, null));
        server.verify();
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                "https://open.feishu.cn/open-apis/test",
                "https://accounts.feishu.cn/oauth/v3/token"
            })
    void acceptsValidOpenApiAndOAuthResponses(String url) {
        FeishuClient client = new FeishuClient();
        RestTemplate http = (RestTemplate) ReflectionTestUtils.getField(client, "http");
        MockRestServiceServer server = MockRestServiceServer.bindTo(http).build();
        String payload =
                url.contains("oauth/v3/token")
                        ? "{\"access_token\":\"test-token\",\"expires_in\":7200}"
                        : "{\"code\":0,\"data\":{}}";
        server.expect(requestTo(url)).andRespond(withSuccess(payload, MediaType.APPLICATION_JSON));
        assertTrue(client.get(url, null).isObject());
        server.verify();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "[]", "{\"code\":\"0\"}", "{\"code\":0.5}", "{\"code\":1}"})
    void rejectsInvalidSuccessEnvelopes(String payload) {
        FeishuClient client = new FeishuClient();
        RestTemplate http = (RestTemplate) ReflectionTestUtils.getField(client, "http");
        MockRestServiceServer server = MockRestServiceServer.bindTo(http).build();
        String url = "https://open.feishu.cn/open-apis/test";
        server.expect(requestTo(url)).andRespond(withSuccess(payload, MediaType.APPLICATION_JSON));
        assertThrows(IllegalStateException.class, () -> client.get(url, "test-token"));
        server.verify();
    }
}
