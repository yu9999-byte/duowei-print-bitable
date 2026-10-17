package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.duowei.print.config.AutomationConfiguration;
import com.duowei.print.integration.feishu.FeishuClient;
import com.duowei.print.repository.BackgroundJobRepository;
import com.duowei.print.security.Protocol;
import com.duowei.print.service.job.BackgroundService;
import com.duowei.print.service.render.RenderService;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.*;
import org.junit.jupiter.api.Test;

class BackgroundValidationTest {
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void signedSubmissionPreservesNewAndReusedResponseContract(boolean existing) throws Exception {
        BackgroundJobRepository jobs = mock(BackgroundJobRepository.class);
        AutomationConfiguration config = mock(AutomationConfiguration.class);
        when(config.workerInterval()).thenReturn(60000L);
        byte[] key = new byte[32];
        when(config.signingSecret(anyString())).thenReturn(key);
        ObjectNode body =
                (ObjectNode)
                        Protocol.JSON.readTree(
                                "{\"version\":1,\"taskKey\":\"duowei-job:v1:"
                                        + String.join("", Collections.nCopies(64, "a"))
                                        + "\",\"tenantKey\":\"tenant\",\"baseToken\":\"base\",\"tableId\":\"table\",\"recordId\":\"record\",\"outputType\":\"pdf\",\"renderRequest\":{\"artifactKey\":\"duowei:v1:test\",\"output\":{\"type\":\"pdf\"}},\"targets\":{\"attachmentFieldId\":\"a\",\"statusFieldId\":\"s\"}}");
        String taskKey = body.path("taskKey").asText();
        when(jobs.exists(taskKey)).thenReturn(existing);
        when(jobs.status(taskKey)).thenReturn("queued");
        ObjectNode claims = Protocol.JSON.createObjectNode();
        claims.put("version", 1)
                .put("audience", "duowei-background-job")
                .put("issuedAt", System.currentTimeMillis())
                .put("expiresAt", System.currentTimeMillis() + 300000)
                .put("taskKey", taskKey)
                .put("bodyDigest", Protocol.digest(Protocol.canonical(body)));
        String signature = Protocol.sign("duowei-background-job-v1", claims, key);
        BackgroundService service =
                new BackgroundService(
                        jobs, mock(FeishuClient.class), mock(RenderService.class), config);
        try {
            org.springframework.http.ResponseEntity<?> result =
                    service.submit(signature, "test-credential-long-enough", body);
            assertEquals(existing ? 200 : 202, result.getStatusCodeValue());
            Map<?, ?> response = (Map<?, ?>) result.getBody();
            assertEquals(taskKey, response.get("jobId"));
            assertEquals(existing, response.get("reused"));
            assertEquals("queued", response.get("status"));
            assertEquals(
                    response.get("traceId"), result.getHeaders().getFirst("x-duowei-trace-id"));
            verify(jobs).createOrRetry(taskKey, body.toString());
            clearInvocations(jobs);
            claims.put("taskKey", "different");
            String wrongSignature = Protocol.sign("duowei-background-job-v1", claims, key);
            assertThrows(
                    SecurityException.class,
                    () -> service.submit(wrongSignature, "test-credential-long-enough", body));
            verifyNoInteractions(jobs);
        } finally {
            service.close();
        }
    }

    @Test
    void sharedNormalizationUsesStrictVersionAndOutputTypes() throws Exception {
        ObjectNode body =
                (ObjectNode)
                        Protocol.JSON.readTree(
                                "{\"version\":1,\"taskKey\":\"duowei-job:v1:"
                                        + String.join("", Collections.nCopies(64, "a"))
                                        + "\",\"tenantKey\":\" tenant \",\"baseToken\":\"base\",\"tableId\":\"table\",\"recordId\":\"record\",\"outputType\":\"pdf\",\"renderRequest\":{\"artifactKey\":\"duowei:v1:test\",\"output\":{\"type\":\"pdf\"}},\"targets\":{\"attachmentFieldId\":\"a\",\"statusFieldId\":\"s\",\"errorFieldId\":42}}");
        ObjectNode normalized = BackgroundService.normalizeSubmission(body);
        assertEquals("tenant", normalized.path("tenantKey").asText());
        assertFalse(normalized.path("targets").has("errorFieldId"));
        assertEquals(" tenant ", body.path("tenantKey").asText());
        body.put("version", "1");
        assertThrows(
                IllegalArgumentException.class, () -> BackgroundService.normalizeSubmission(body));
        body.put("version", 1.5);
        assertThrows(
                IllegalArgumentException.class, () -> BackgroundService.normalizeSubmission(body));
        body.put("version", 1).put("outputType", " pdf ");
        assertThrows(
                IllegalArgumentException.class, () -> BackgroundService.normalizeSubmission(body));
    }

    @Test
    void rejectsMissingCredentialsBeforePersistence() {
        BackgroundJobRepository jobs = mock(BackgroundJobRepository.class);
        AutomationConfiguration config = mock(AutomationConfiguration.class);
        when(config.workerInterval()).thenReturn(60000L);
        BackgroundService service =
                new BackgroundService(
                        jobs, mock(FeishuClient.class), mock(RenderService.class), config);
        try {
            assertThrows(
                    IllegalArgumentException.class,
                    () -> service.submit("", "", Protocol.JSON.createObjectNode()));
            verifyNoInteractions(jobs);
        } finally {
            service.close();
        }
    }

    @Test
    void rejectsDuplicateTargetFieldsBeforeSignatureOrDatabase() {
        BackgroundJobRepository jobs = mock(BackgroundJobRepository.class);
        AutomationConfiguration config = mock(AutomationConfiguration.class);
        when(config.workerInterval()).thenReturn(60000L);
        BackgroundService service =
                new BackgroundService(
                        jobs, mock(FeishuClient.class), mock(RenderService.class), config);
        ObjectNode body = Protocol.JSON.createObjectNode();
        body.put("version", 1);
        body.put("taskKey", "duowei-job:v1:" + String.join("", Collections.nCopies(64, "a")));
        for (String key : Arrays.asList("tenantKey", "baseToken", "tableId", "recordId"))
            body.put(key, "test");
        body.put("outputType", "pdf");
        ObjectNode render = body.putObject("renderRequest");
        render.put("artifactKey", "duowei:v1:test");
        render.putObject("output").put("type", "pdf");
        body.putObject("targets").put("attachmentFieldId", "same").put("statusFieldId", "same");
        try {
            IllegalArgumentException error =
                    assertThrows(
                            IllegalArgumentException.class,
                            () -> service.submit("", "test-credential-long-enough", body));
            assertTrue(error.getMessage().contains("不能重复"));
            verifyNoInteractions(jobs);
        } finally {
            service.close();
        }
    }
}
