package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;

import com.duowei.print.integration.feishu.FeishuClient;
import com.duowei.print.security.Protocol;
import com.fasterxml.jackson.databind.JsonNode;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.util.StreamUtils;

class FeishuHttpIntegrationTest {
    @Test
    void realMultipartUploadPreservesFileBytesAndPartMetadata() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<byte[]> wire = new AtomicReference<>();
        AtomicReference<String> contentType = new AtomicReference<>();
        server.createContext(
                "/upload",
                exchange -> {
                    try {
                        wire.set(StreamUtils.copyToByteArray(exchange.getRequestBody()));
                        contentType.set(exchange.getRequestHeaders().getFirst("Content-Type"));
                        byte[] response =
                                "{\"code\":0,\"data\":{\"file_token\":\"uploaded\"}}"
                                        .getBytes(StandardCharsets.UTF_8);
                        exchange.getResponseHeaders().set("Content-Type", "application/json");
                        exchange.sendResponseHeaders(200, response.length);
                        exchange.getResponseBody().write(response);
                    } finally {
                        exchange.close();
                    }
                });
        server.start();
        try {
            byte[] bytes = new byte[] {37, 80, 68, 70, 45, 0, (byte) 255, 13, 10};
            org.springframework.util.LinkedMultiValueMap<String, Object> form =
                    new org.springframework.util.LinkedMultiValueMap<>();
            form.add("file_name", "test.pdf");
            form.add("parent_type", "bitable_file");
            form.add("parent_node", "base");
            form.add("size", String.valueOf(bytes.length));
            org.springframework.http.HttpHeaders headers =
                    new org.springframework.http.HttpHeaders();
            headers.setContentType(org.springframework.http.MediaType.APPLICATION_PDF);
            form.add(
                    "file",
                    new org.springframework.http.HttpEntity<>(
                            new org.springframework.core.io.ByteArrayResource(bytes) {
                                @Override
                                public String getFilename() {
                                    return "test.pdf";
                                }
                            },
                            headers));
            JsonNode result =
                    new FeishuClient()
                            .call(
                                    "http://127.0.0.1:" + server.getAddress().getPort() + "/upload",
                                    org.springframework.http.HttpMethod.POST,
                                    form,
                                    "test-only-token",
                                    org.springframework.http.MediaType.MULTIPART_FORM_DATA);
            assertEquals("uploaded", result.path("data").path("file_token").asText());
            assertTrue(contentType.get().startsWith("multipart/form-data;boundary="));
            String payload = new String(wire.get(), StandardCharsets.ISO_8859_1);
            assertTrue(payload.contains("name=\"file\"; filename=\"test.pdf\""));
            assertTrue(payload.contains("Content-Type: application/pdf"));
            assertTrue(payload.contains("name=\"parent_type\""));
            assertTrue(payload.contains("\r\n\r\nbitable_file\r\n"));
            assertTrue(payload.contains(new String(bytes, StandardCharsets.ISO_8859_1)));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void realLoopbackHttpPreservesEncodedUrlBearerAndChineseJson() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> uri = new AtomicReference<>();
        AtomicReference<String> authorization = new AtomicReference<>();
        AtomicReference<String> method = new AtomicReference<>();
        AtomicReference<String> requestBody = new AtomicReference<>();
        server.createContext(
                "/",
                exchange -> {
                    try {
                        uri.set(exchange.getRequestURI().toASCIIString());
                        authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
                        method.set(exchange.getRequestMethod());
                        requestBody.set(
                                StreamUtils.copyToString(
                                        exchange.getRequestBody(), StandardCharsets.UTF_8));
                        byte[] response =
                                "{\"code\":0,\"data\":{\"name\":\"发货单\"}}"
                                        .getBytes(StandardCharsets.UTF_8);
                        exchange.getResponseHeaders()
                                .set("Content-Type", "application/json;charset=UTF-8");
                        exchange.sendResponseHeaders(200, response.length);
                        exchange.getResponseBody().write(response);
                    } finally {
                        exchange.close();
                    }
                });
        server.start();
        try {
            String path =
                    "/apps/"
                            + FeishuClient.enc("base/a")
                            + "?page_token="
                            + FeishuClient.enc("next/中文+");
            JsonNode body = Protocol.JSON.readTree("{\"fields\":{\"状态\":\"生成成功\"}}");
            JsonNode result =
                    new FeishuClient()
                            .post(
                                    "http://127.0.0.1:" + server.getAddress().getPort() + path,
                                    body,
                                    "test-only-token");
            assertEquals(path, uri.get());
            assertEquals("POST", method.get());
            assertEquals("Bearer test-only-token", authorization.get());
            assertEquals(body, Protocol.JSON.readTree(requestBody.get()));
            assertEquals("发货单", result.path("data").path("name").asText());
        } finally {
            server.stop(0);
        }
    }
}
