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

    @Test
    void successUploadsAndUpdatesOnlySelectedFields() throws Exception {
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
                                "{\"data\":{\"items\":[{\"field_id\":\"a\",\"field_name\":\"attachment\",\"type\":17},{\"field_id\":\"s\",\"field_name\":\"status\",\"type\":1}],\"has_more\":false}}"));
        when(jobs.status("job")).thenReturn("queued");
        RenderService.Artifact artifact = new RenderService.Artifact();
        artifact.bytes = new byte[] {1, 2};
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
            verify(jobs).succeed("job", "file-token");
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
