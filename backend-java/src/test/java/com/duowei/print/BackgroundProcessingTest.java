package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.duowei.print.config.AutomationConfiguration;
import com.duowei.print.integration.feishu.FeishuClient;
import com.duowei.print.repository.BackgroundJobRepository;
import com.duowei.print.security.Protocol;
import com.duowei.print.service.job.BackgroundService;
import com.duowei.print.service.render.RenderService;
import com.fasterxml.jackson.databind.JsonNode;
import java.lang.reflect.Method;
import org.junit.jupiter.api.Test;

class BackgroundProcessingTest {
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(
            strings = {
                "{}",
                "{\"items\":{}}",
                "{\"items\":[{\"field_id\":\"a\",\"field_name\":\"附件\",\"type\":17.5},{\"field_id\":\"s\",\"field_name\":\"状态\",\"type\":1}]}"
            })
    void rejectsMalformedFieldMetadataBeforeRendering(String data) throws Exception {
        BackgroundJobRepository jobs = mock(BackgroundJobRepository.class);
        FeishuClient api = mock(FeishuClient.class);
        RenderService renderer = mock(RenderService.class);
        AutomationConfiguration config = mock(AutomationConfiguration.class);
        when(config.workerInterval()).thenReturn(60000L);
        when(api.get(anyString(), eq("token")))
                .thenReturn(Protocol.JSON.readTree("{\"data\":" + data + "}"));
        JsonNode body =
                Protocol.JSON.readTree(
                        "{\"baseToken\":\"base\",\"tableId\":\"table\",\"recordId\":\"record\",\"targets\":{\"attachmentFieldId\":\"a\",\"statusFieldId\":\"s\"}}");
        BackgroundService service = new BackgroundService(jobs, api, renderer, config);
        try {
            Method process =
                    BackgroundService.class.getDeclaredMethod(
                            "process", String.class, JsonNode.class, String.class);
            process.setAccessible(true);
            process.invoke(service, "job", body, "token");
            verify(jobs).fail(eq("job"), anyString());
            verify(jobs, never()).processing(anyString());
            verifyNoInteractions(renderer);
            verify(api, never()).call(anyString(), any(), any(), any(), any());
        } finally {
            service.close();
        }
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(
            strings = {
                "key",
                "missingAttempt",
                "negativeAttempt",
                "fractionalAttempt",
                "invalidStatus"
            })
    void recoveryRejectsInvalidPersistedRowBeforeCallingFeishu(String invalid) throws Exception {
        BackgroundJobRepository jobs = mock(BackgroundJobRepository.class);
        FeishuClient api = mock(FeishuClient.class);
        RenderService renderer = mock(RenderService.class);
        AutomationConfiguration config = mock(AutomationConfiguration.class);
        when(config.workerInterval()).thenReturn(60000L);
        java.util.Map<String, Object> row = new java.util.HashMap<>();
        String taskKey = "duowei-job:v1:" + String.join("", java.util.Collections.nCopies(64, "a"));
        row.put("job_id", taskKey);
        row.put("task_key", "key".equals(invalid) ? "different" : taskKey);
        row.put("status", "invalidStatus".equals(invalid) ? "unknown" : "queued");
        if (!"missingAttempt".equals(invalid)) {
            row.put("attempt", "negativeAttempt".equals(invalid) ? -1 : 0);
            if ("fractionalAttempt".equals(invalid)) row.put("attempt", 0.5);
        }
        row.put(
                "submission",
                "{\"version\":1,\"taskKey\":\""
                        + taskKey
                        + "\",\"tenantKey\":\"tenant\",\"baseToken\":\"base\",\"tableId\":\"table\",\"recordId\":\"record\",\"outputType\":\"pdf\",\"renderRequest\":{\"artifactKey\":\"duowei:v1:test\",\"output\":{\"type\":\"pdf\"}},\"targets\":{\"attachmentFieldId\":\"a\",\"statusFieldId\":\"s\"}}");
        when(jobs.recoverable()).thenReturn(java.util.Collections.singletonList(row));
        BackgroundService service = new BackgroundService(jobs, api, renderer, config);
        try {
            Method drain = BackgroundService.class.getDeclaredMethod("drain");
            drain.setAccessible(true);
            drain.invoke(service);
            verifyNoInteractions(api, renderer);
            verify(jobs, never()).processing(anyString());
        } finally {
            service.close();
        }
    }

    @Test
    void renderingFailurePersistsFailureAndDoesNotUpload() throws Exception {
        BackgroundJobRepository jobs = mock(BackgroundJobRepository.class);
        FeishuClient api = mock(FeishuClient.class);
        RenderService renderer = mock(RenderService.class);
        AutomationConfiguration config = mock(AutomationConfiguration.class);
        when(config.workerInterval()).thenReturn(60000L);
        JsonNode body =
                Protocol.JSON.readTree(
                        "{\"baseToken\":\"base\",\"tableId\":\"table\",\"recordId\":\"record\",\"renderRequest\":{},\"targets\":{\"attachmentFieldId\":\"a\",\"statusFieldId\":\"s\"}}");
        when(api.get(anyString(), eq("token")))
                .thenReturn(
                        Protocol.JSON.readTree(
                                "{\"data\":{\"items\":[{\"field_id\":\"a\",\"field_name\":\"附件\",\"type\":17},{\"field_id\":\"s\",\"field_name\":\"状态\",\"type\":1}],\"has_more\":false}}"));
        when(jobs.status("job")).thenReturn("queued");
        when(renderer.render(any())).thenThrow(new IllegalStateException("Bearer secret failed"));
        when(api.call(contains("/records/"), any(), any(), eq("token"), any()))
                .thenAnswer(
                        invocation -> {
                            JsonNode fields = ((JsonNode) invocation.getArgument(2)).path("fields");
                            if ("生成失败".equals(fields.path("状态").asText()))
                                throw new IllegalStateException("secondary write failure");
                            return Protocol.JSON.createObjectNode();
                        });
        BackgroundService service = new BackgroundService(jobs, api, renderer, config);
        try {
            Method process =
                    BackgroundService.class.getDeclaredMethod(
                            "process", String.class, JsonNode.class, String.class);
            process.setAccessible(true);
            process.invoke(service, "job", body, "token");
            verify(jobs).processing("job");
            verify(jobs)
                    .fail(
                            eq("job"),
                            argThat(
                                    message ->
                                            message.contains("[已隐藏]")
                                                    && !message.contains("secret")));
            verify(jobs, never()).succeed(anyString(), anyString());
            verify(api, never()).call(contains("upload_all"), any(), any(), any(), any());
        } finally {
            service.close();
        }
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(ints = {2, 20971520, 20971521})
    void successUploadsAndUpdatesOnlySelectedFields(int byteCount) throws Exception {
        BackgroundJobRepository jobs = mock(BackgroundJobRepository.class);
        FeishuClient api = mock(FeishuClient.class);
        RenderService renderer = mock(RenderService.class);
        AutomationConfiguration config = mock(AutomationConfiguration.class);
        when(config.workerInterval()).thenReturn(60000L);
        JsonNode body =
                Protocol.JSON.readTree(
                        "{\"baseToken\":\"base\",\"tableId\":\"table\",\"recordId\":\"record\",\"renderRequest\":{},\"targets\":{\"attachmentFieldId\":\"a\",\"statusFieldId\":\"s\"}}");
        when(api.get(anyString(), eq("token")))
                .thenReturn(
                        Protocol.JSON.readTree(
                                "{\"data\":{\"items\":[{\"field_id\":\"a\",\"field_name\":\"attachment\",\"type\":17}],\"has_more\":true,\"page_token\":\"next/page\"}}"),
                        Protocol.JSON.readTree(
                                "{\"data\":{\"items\":[{\"field_id\":\"s\",\"field_name\":\"status\",\"type\":1}],\"has_more\":false}}"));
        when(jobs.status("job")).thenReturn("queued");
        RenderService.Artifact artifact = new RenderService.Artifact();
        artifact.bytes = new byte[byteCount];
        artifact.fileName = "test.pdf";
        artifact.contentType = "application/pdf";
        when(renderer.render(any())).thenReturn(artifact);
        when(api.call(contains("upload_all"), any(), any(), eq("token"), any()))
                .thenReturn(Protocol.JSON.readTree("{\"data\":{\"file_token\":\"file-token\"}}"));
        java.util.List<JsonNode> writes = new java.util.ArrayList<>();
        when(api.call(contains("/records/"), any(), any(), eq("token"), any()))
                .thenAnswer(
                        invocation -> {
                            writes.add(((JsonNode) invocation.getArgument(2)).deepCopy());
                            return Protocol.JSON.createObjectNode();
                        });
        BackgroundService service = new BackgroundService(jobs, api, renderer, config);
        try {
            Method process =
                    BackgroundService.class.getDeclaredMethod(
                            "process", String.class, JsonNode.class, String.class);
            process.setAccessible(true);
            process.invoke(service, "job", body, "token");
            verify(api).get(contains("page_token=next%2Fpage"), eq("token"));
            if (byteCount > 20 * 1024 * 1024) {
                verify(jobs).fail(eq("job"), contains("20MB"));
                verify(api, never()).call(contains("upload_all"), any(), any(), any(), any());
                verify(jobs, never()).succeed(anyString(), anyString());
                return;
            }
            verify(jobs).succeed("job", "file-token");
            org.mockito.ArgumentCaptor<Object> uploadBody =
                    org.mockito.ArgumentCaptor.forClass(Object.class);
            verify(api)
                    .call(
                            contains("upload_all"),
                            eq(org.springframework.http.HttpMethod.POST),
                            uploadBody.capture(),
                            eq("token"),
                            eq(org.springframework.http.MediaType.MULTIPART_FORM_DATA));
            org.springframework.util.MultiValueMap<?, ?> form =
                    (org.springframework.util.MultiValueMap<?, ?>) uploadBody.getValue();
            assertEquals("test.pdf", form.get("file_name").get(0));
            assertEquals("bitable_file", form.get("parent_type").get(0));
            assertEquals("base", form.get("parent_node").get(0));
            assertEquals(String.valueOf(byteCount), form.get("size").get(0));
            org.springframework.http.HttpEntity<?> filePart =
                    (org.springframework.http.HttpEntity<?>) form.get("file").get(0);
            assertEquals(
                    org.springframework.http.MediaType.APPLICATION_PDF,
                    filePart.getHeaders().getContentType());
            org.springframework.core.io.ByteArrayResource resource =
                    (org.springframework.core.io.ByteArrayResource) filePart.getBody();
            assertEquals("test.pdf", resource.getFilename());
            assertArrayEquals(artifact.bytes, resource.getByteArray());
            verify(jobs, never()).fail(anyString(), anyString());
            assertEquals(3, writes.size());
            JsonNode fields = writes.get(2).path("fields");
            assertEquals(2, fields.size());
            assertEquals("生成成功", fields.path("status").asText());
            assertEquals(
                    "file-token", fields.path("attachment").get(0).path("file_token").asText());
        } finally {
            service.close();
        }
    }
}
