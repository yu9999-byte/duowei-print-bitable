package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;

import com.duowei.print.config.AutomationConfiguration;
import com.duowei.print.exception.SafeMessages;
import java.util.*;
import org.junit.jupiter.api.Test;

class ConfigurationTest {
    private Map<String, String> valid() {
        Map<String, String> v = new HashMap<>();
        v.put("DUOWEI_SERVICE_AUTHORIZATION", "Bearer test-only");
        for (String key :
                Arrays.asList(
                        "DUOWEI_REGISTRY_WRITE_SIGNING_SECRET_HEX",
                        "DUOWEI_REGISTRY_READ_SIGNING_SECRET_HEX",
                        "DUOWEI_RENDERER_SIGNING_SECRET_HEX",
                        "DUOWEI_BACKGROUND_JOB_SIGNING_SECRET_HEX"))
            v.put(key, String.join("", Collections.nCopies(32, "11")));
        v.put("DUOWEI_FEISHU_APP_ID", "cli_test");
        v.put("DUOWEI_FEISHU_APP_SECRET", "test-only");
        v.put("DUOWEI_EVENT_VERIFICATION_TOKEN", "test-only");
        v.put("DUOWEI_RENDER_PAGE_URL", "https://service.example/openapi/duowei-print/renderer");
        v.put("DUOWEI_ALLOWED_ORIGINS", "https://plugin.example");
        v.put("DUOWEI_PUBLIC_AUTOMATION_BASE_URL", "https://service.example/openapi/duowei-print");
        v.put("DUOWEI_OAUTH_REDIRECT_URI", "https://service.example/api/automation/oauth/callback");
        return v;
    }

    @Test
    void validConfigurationPasses() {
        new AutomationConfiguration(valid()).validate();
    }

    @Test
    void rejectsWeakSecret() {
        Map<String, String> v = valid();
        v.put("DUOWEI_RENDERER_SIGNING_SECRET_HEX", "aa");
        assertThrows(IllegalStateException.class, () -> new AutomationConfiguration(v).validate());
    }

    @Test
    void rejectsForeignCallback() {
        Map<String, String> v = valid();
        v.put("DUOWEI_OAUTH_REDIRECT_URI", "https://other.example/api/automation/oauth/callback");
        assertThrows(IllegalStateException.class, () -> new AutomationConfiguration(v).validate());
    }

    @Test
    void rejectsUnsafeOriginsAndIntervals() {
        Map<String, String> v = valid();
        v.put("DUOWEI_ALLOWED_ORIGINS", "https://plugin.example/path");
        assertThrows(IllegalStateException.class, () -> new AutomationConfiguration(v).validate());
        Map<String, String> intervals = valid();
        intervals.put("DUOWEI_BACKGROUND_WORKER_INTERVAL_MS", "100");
        final Map<String, String> invalid = intervals;
        assertThrows(
                IllegalStateException.class, () -> new AutomationConfiguration(invalid).validate());
    }

    @Test
    void redactsCredentials() {
        String result = SafeMessages.sanitize("Bearer abc.def user_access_token=secret");
        assertFalse(result.contains("abc.def"));
        assertFalse(result.contains("=secret"));
    }
}
