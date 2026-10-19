package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;

import com.duowei.print.security.Protocol;
import com.fasterxml.jackson.databind.node.ArrayNode;
import java.nio.file.*;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.openqa.selenium.chrome.*;

/** Diagnostic only; each sample owns and closes its driver service and browser. */
@EnabledIfEnvironmentVariable(named = "DUOWEI_TEST_REAL_BROWSER", matches = "true")
class DriverStartupTimingTest {
    @Test
    void measuresIndependentSessionsOnPrestartedDriverService() throws Exception {
        ChromeDriverService service = new ChromeDriverService.Builder().usingAnyFreePort().build();
        ArrayNode samples = Protocol.JSON.createArrayNode();
        java.util.Set<String> sessions = new java.util.HashSet<>();
        Path directory =
                Files.createDirectories(
                        Paths.get("target/driver-timing", UUID.randomUUID().toString()));
        try {
            service.start();
            for (int i = 0; i < 5; i++) {
                ChromeOptions options = new ChromeOptions();
                options.addArguments("--headless=new", "--disable-dev-shm-usage");
                options.setBinary(System.getenv("DUOWEI_CHROMIUM_EXECUTABLE_PATH"));
                long started = System.nanoTime();
                org.openqa.selenium.remote.RemoteWebDriver driver =
                        new org.openqa.selenium.remote.RemoteWebDriver(service.getUrl(), options);
                long ready = System.nanoTime();
                try {
                    assertTrue(sessions.add(driver.getSessionId().toString()));
                    assertEquals("complete", driver.executeScript("return document.readyState"));
                    assertEquals(
                            "undefined",
                            driver.executeScript("return typeof window.__isolationProbe"));
                    driver.executeScript("window.__isolationProbe = true");
                } finally {
                    driver.quit();
                }
                assertTrue(service.isRunning(), "DELETE session must retain the shared service");
                samples.addObject()
                        .put("iteration", i)
                        .put("sessionStartMs", (ready - started) / 1000000.0)
                        .put("cleanupAndProbeMs", (System.nanoTime() - ready) / 1000000.0);
                Files.write(
                        directory.resolve("prestarted-samples.json"),
                        Protocol.JSON.writerWithDefaultPrettyPrinter().writeValueAsBytes(samples));
            }
        } finally {
            service.stop();
            assertFalse(service.isRunning());
        }
    }

    @Test
    void separatesServiceStartupFromBrowserSession() throws Exception {
        ArrayNode samples = Protocol.JSON.createArrayNode();
        for (int i = 0; i < 5; i++) {
            ChromeDriverService service =
                    new ChromeDriverService.Builder().usingAnyFreePort().build();
            ChromeDriver driver = null;
            long started = System.nanoTime();
            try {
                service.start();
                long serviceReady = System.nanoTime();
                ChromeOptions options = new ChromeOptions();
                options.addArguments("--headless=new", "--disable-dev-shm-usage");
                options.setBinary(System.getenv("DUOWEI_CHROMIUM_EXECUTABLE_PATH"));
                driver = new ChromeDriver(service, options);
                long sessionReady = System.nanoTime();
                assertEquals("complete", driver.executeScript("return document.readyState"));
                driver.quit();
                driver = null;
                service.stop();
                long stopped = System.nanoTime();
                assertFalse(service.isRunning());
                samples.addObject()
                        .put("iteration", i)
                        .put("serviceStartMs", (serviceReady - started) / 1000000.0)
                        .put("sessionStartMs", (sessionReady - serviceReady) / 1000000.0)
                        .put("cleanupAndProbeMs", (stopped - sessionReady) / 1000000.0);
            } finally {
                if (driver != null) driver.quit();
                service.stop();
            }
        }
        Path directory =
                Files.createDirectories(
                        Paths.get("target/driver-timing", UUID.randomUUID().toString()));
        Files.write(
                directory.resolve("samples.json"),
                Protocol.JSON.writerWithDefaultPrettyPrinter().writeValueAsBytes(samples));
    }
}
