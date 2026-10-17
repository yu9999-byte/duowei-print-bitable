package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.duowei.print.config.AutomationConfiguration;
import com.duowei.print.security.Protocol;
import com.duowei.print.service.render.RenderService;
import java.time.Duration;
import java.util.Collections;
import org.junit.jupiter.api.Test;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;

class BrowserLifecycleTest {
    @Test
    void shutdownDuringDriverStartupClosesLateDriverWithoutNavigating() throws Exception {
        ChromeDriver driver = mock(ChromeDriver.class);
        RenderService renderer =
                new RenderService(mock(AutomationConfiguration.class)) {
                    @Override
                    protected ChromeDriver createDriver(ChromeOptions options) {
                        close();
                        return driver;
                    }
                };
        com.fasterxml.jackson.databind.JsonNode body =
                Protocol.JSON.readTree(
                        "{\"artifactKey\":\"duowei:v1:test\",\"template\":{\"id\":\"a\",\"revision\":\"r1\",\"snapshot\":{}},\"values\":{},\"output\":{\"type\":\"pdf\",\"pageLimit\":null}}");
        assertTrue(
                assertThrows(IllegalStateException.class, () -> renderer.render(body))
                        .getMessage()
                        .contains("已关闭"));
        verify(driver).quit();
        verifyNoMoreInteractions(driver);
        assertThrows(IllegalStateException.class, () -> renderer.render(body));
        verifyNoMoreInteractions(driver);
    }

    @Test
    void failedNavigationClosesDriverAndPreservesFailureEvenWhenQuitFails() throws Exception {
        AutomationConfiguration config = mock(AutomationConfiguration.class);
        when(config.required("DUOWEI_SERVICE_AUTHORIZATION")).thenReturn("Bearer test-only");
        when(config.required("DUOWEI_RENDER_PAGE_URL"))
                .thenReturn("https://service.example/renderer");
        ChromeDriver driver = mock(ChromeDriver.class);
        WebDriver.Options options = mock(WebDriver.Options.class);
        WebDriver.Timeouts timeouts = mock(WebDriver.Timeouts.class);
        when(driver.manage()).thenReturn(options);
        when(options.timeouts()).thenReturn(timeouts);
        IllegalStateException navigation = new IllegalStateException("navigation failed");
        doThrow(navigation).when(driver).get("https://service.example/renderer");
        doThrow(new IllegalStateException("cleanup failed")).when(driver).quit();
        RenderService renderer =
                new RenderService(config) {
                    @Override
                    protected ChromeDriver createDriver(ChromeOptions launchOptions) {
                        return driver;
                    }
                };
        assertSame(
                navigation,
                assertThrows(
                        IllegalStateException.class,
                        () ->
                                renderer.render(
                                        Protocol.JSON.readTree(
                                                "{\"artifactKey\":\"duowei:v1:test\",\"template\":{\"id\":\"a\",\"revision\":\"r1\",\"snapshot\":{}},\"values\":{},\"output\":{\"type\":\"pdf\",\"pageLimit\":null}}"))));
        org.mockito.InOrder order = inOrder(driver, timeouts);
        order.verify(timeouts).pageLoadTimeout(Duration.ofSeconds(30));
        order.verify(timeouts).scriptTimeout(Duration.ofSeconds(90));
        order.verify(driver).executeCdpCommand("Network.enable", Collections.emptyMap());
        order.verify(driver)
                .executeCdpCommand(
                        "Network.setExtraHTTPHeaders",
                        Collections.singletonMap(
                                "headers",
                                Collections.singletonMap("Authorization", "Bearer test-only")));
        order.verify(driver).get("https://service.example/renderer");
        order.verify(driver).quit();
        renderer.close();
        verify(driver, times(1)).quit();
    }
}
