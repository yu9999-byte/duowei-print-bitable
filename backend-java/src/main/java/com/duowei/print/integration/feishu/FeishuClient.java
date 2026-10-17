package com.duowei.print.integration.feishu;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;
import org.springframework.http.*;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

@Service
public class FeishuClient {
    private final RestTemplate http;

    public FeishuClient() {
        SimpleClientHttpRequestFactory f = new SimpleClientHttpRequestFactory();
        f.setConnectTimeout(10000);
        f.setReadTimeout(30000);
        http = new RestTemplate(f);
    }

    public JsonNode call(String url, HttpMethod method, Object body, String token, MediaType type) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(type);
        if (token != null) headers.setBearerAuth(token);
        JsonNode result =
                http.exchange(
                                java.net.URI.create(url),
                                method,
                                new HttpEntity<>(body, headers),
                                JsonNode.class)
                        .getBody();
        if (result == null
                || !result.isObject()
                || result.has("error")
                || result.has("code")
                        && (!result.path("code").isNumber()
                                || result.path("code").doubleValue() != 0.0)
                || !result.has("code")) throw new IllegalStateException("飞书接口请求失败");
        return result;
    }

    public JsonNode get(String url, String token) {
        return call(url, HttpMethod.GET, null, token, MediaType.APPLICATION_JSON);
    }

    public JsonNode post(String url, Object body, String token) {
        return call(url, HttpMethod.POST, body, token, MediaType.APPLICATION_JSON);
    }

    public static String env(String key) {
        String v = System.getenv(key);
        if (v == null || v.trim().isEmpty()) throw new IllegalStateException(key + "不能为空");
        return v.trim();
    }

    public static String enc(String value) {
        try {
            return java.net.URLEncoder.encode(value, "UTF-8").replace("+", "%20");
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
