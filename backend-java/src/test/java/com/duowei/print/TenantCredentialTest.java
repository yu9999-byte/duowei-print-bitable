package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.duowei.print.config.AutomationConfiguration;
import com.duowei.print.integration.feishu.FeishuClient;
import com.duowei.print.repository.BackgroundJobRepository;
import com.duowei.print.service.job.BackgroundService;
import com.duowei.print.service.render.RenderService;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class TenantCredentialTest {
    @Test
    @SuppressWarnings("unchecked")
    void expiredCredentialsAreRemovedAndShutdownClearsRemainingCredentials() {
        AutomationConfiguration configuration = mock(AutomationConfiguration.class);
        when(configuration.workerInterval()).thenReturn(60000L);
        BackgroundService service =
                new BackgroundService(
                        mock(BackgroundJobRepository.class),
                        mock(FeishuClient.class),
                        mock(RenderService.class),
                        configuration);
        Map<String, String> tokens =
                (Map<String, String>) ReflectionTestUtils.getField(service, "tokens");
        Map<String, Long> expires =
                (Map<String, Long>) ReflectionTestUtils.getField(service, "expires");
        try {
            tokens.put("expired", "expired-token");
            expires.put("expired", 0L);
            tokens.put("current", "current-token");
            expires.put("current", System.currentTimeMillis() + 60000);
            assertNull(ReflectionTestUtils.invokeMethod(service, "tokenFor", "expired"));
            assertFalse(tokens.containsKey("expired"));
            assertFalse(expires.containsKey("expired"));
            assertEquals(
                    "current-token",
                    ReflectionTestUtils.invokeMethod(service, "tokenFor", "current"));
        } finally {
            service.close();
        }
        assertTrue(tokens.isEmpty());
        assertTrue(expires.isEmpty());
    }
}
