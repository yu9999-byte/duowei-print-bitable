package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;

import com.duowei.print.config.AutomationConfiguration;
import com.duowei.print.exception.SafeMessages;
import java.util.*;
import org.junit.jupiter.api.Test;

class ConfigurationTest {
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(
            strings = {" 2000 ", "2e3", "2000.0", "0x7d0", "0b11111010000", "0o3720"})
    void workerIntervalPreservesOriginalNumericConfigurationForms(String value) {
        Map<String, String> values = valid();
        values.put("DUOWEI_BACKGROUND_WORKER_INTERVAL_MS", value);
        assertEquals(2000, new AutomationConfiguration(values).workerInterval());
    }

    @Test
    void originListSkipsEmptyItemsAndNormalizesHostAndDefaultPort() {
        Map<String, String> values = valid();
        values.put(
                "DUOWEI_ALLOWED_ORIGINS",
                ", https://PLUGIN.example:443/,,https://plugin.example, ");
        assertEquals(
                Collections.singleton("https://plugin.example"),
                new AutomationConfiguration(values).allowedOrigins());
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource({
        "DUOWEI_REGISTRY_READ_SIGNING_SECRET_HEX,zz",
        "DUOWEI_BACKGROUND_WORKER_INTERVAL_MS,100",
        "DUOWEI_BACKGROUND_WORKER_INTERVAL_MS,60001",
        "DUOWEI_BACKGROUND_WORKER_INTERVAL_MS,1.5",
        "DUOWEI_RENDER_PAGE_URL,http://service.example/renderer",
        "DUOWEI_FEISHU_APP_ID,app_wrong",
        "DUOWEI_PUBLIC_AUTOMATION_BASE_URL,https://service.example/wrong",
        "DUOWEI_OAUTH_REDIRECT_URI,https://other.example/oauth/callback"
    })
    void originalConfigurationFailureCasesAreRejected(String key, String value) {
        Map<String, String> values = valid();
        values.put(key, value);
        assertThrows(RuntimeException.class, () -> new AutomationConfiguration(values).validate());
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(
            strings = {
                "DUOWEI_SERVICE_AUTHORIZATION", "DUOWEI_RENDERER_SIGNING_SECRET_HEX",
                "DUOWEI_BACKGROUND_JOB_SIGNING_SECRET_HEX", "DUOWEI_EVENT_VERIFICATION_TOKEN",
                "DUOWEI_FEISHU_APP_SECRET"
            })
    void requiredConfigurationCannotBeEmpty(String key) {
        Map<String, String> values = valid();
        values.put(key, "");
        assertThrows(
                IllegalStateException.class, () -> new AutomationConfiguration(values).validate());
    }

    @Test
    void legacyOpenApiCallbackAndWorkerBoundsRemainSupported() {
        Map<String, String> values = valid();
        values.put(
                "DUOWEI_OAUTH_REDIRECT_URI",
                "https://service.example/openapi/duowei-print/oauth/callback");
        for (String interval : Arrays.asList("250", "60000")) {
            values.put("DUOWEI_BACKGROUND_WORKER_INTERVAL_MS", interval);
            AutomationConfiguration config = new AutomationConfiguration(values);
            assertDoesNotThrow(config::validate);
            assertEquals(Long.parseLong(interval), config.workerInterval());
        }
    }

    @Test
    void rejectsCommaOnlyOriginConfiguration() {
        Map<String, String> values = valid();
        values.put("DUOWEI_ALLOWED_ORIGINS", ",,,");
        assertThrows(
                IllegalStateException.class, () -> new AutomationConfiguration(values).validate());
    }

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
