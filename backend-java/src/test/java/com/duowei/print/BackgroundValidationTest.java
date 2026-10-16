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
