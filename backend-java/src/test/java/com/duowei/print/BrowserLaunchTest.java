package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;

import com.duowei.print.service.render.RenderService;
import org.junit.jupiter.api.Test;

class BrowserLaunchTest {
    @Test
    void startupDiagnosticsPreserveActionableTailWithoutCredentials() {
        StringBuilder noise = new StringBuilder();
        for (int i = 0; i < 800; i++) noise.append('x');
        IllegalStateException failure =
                RenderService.launchFailure(
                        new IllegalStateException(
                                "launch failed\nBearer secret-token\n/tmp/chromium: version 'GLIBC_2.28' not found\n"
                                        + noise
                                        + "\n[pid=7] exitCode=1, signal=null"));
        assertFalse(failure.getMessage().contains("secret-token"));
        assertTrue(failure.getMessage().contains("GLIBC_2.28"));
        assertTrue(failure.getMessage().contains("exitCode=1"));
        assertTrue(failure.getMessage().contains("platform="));
        assertTrue(failure.getMessage().contains("arch="));
        assertTrue(failure.getMessage().length() < 600);
    }
}
