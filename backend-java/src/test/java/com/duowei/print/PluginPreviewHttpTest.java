package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;

import com.duowei.print.config.PluginPreviewConfiguration;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.*;
import java.util.regex.*;
import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.util.StreamUtils;

/** Starts a real embedded HTTP server with the production preview resource configuration. */
class PluginPreviewHttpTest {
    @SpringBootConfiguration
    @EnableAutoConfiguration(exclude = DataSourceAutoConfiguration.class)
    @Import(PluginPreviewConfiguration.class)
    static class PreviewApplication {}

    private byte[] get(int port, String path) throws Exception {
        HttpURLConnection connection =
                (HttpURLConnection) new URL("http://127.0.0.1:" + port + path).openConnection();
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(10000);
        try {
            assertEquals(200, connection.getResponseCode(), path);
            return StreamUtils.copyToByteArray(connection.getInputStream());
        } finally {
            connection.disconnect();
        }
    }

    @Test
    void servesActualPluginHtmlAndEntryScriptsOverHttp() throws Exception {
        Path build = Paths.get("..", "record-view", "dist").toAbsolutePath().normalize();
        assertTrue(
                Files.isRegularFile(build.resolve("index.html")),
                "Original plugin build is required");
        SpringApplication application = new SpringApplication(PreviewApplication.class);
        try (ServletWebServerApplicationContext context =
                (ServletWebServerApplicationContext)
                        application.run(
                                "--server.address=127.0.0.1",
                                "--server.port=0",
                                "--duowei.plugin-preview-directory=" + build)) {
            int port = context.getWebServer().getPort();
            byte[] html = get(port, "/plugin-preview/index.html");
            assertArrayEquals(Files.readAllBytes(build.resolve("index.html")), html);
            Matcher scripts =
                    Pattern.compile("src=\"\\./([^\"]+\\.js)\"")
                            .matcher(new String(html, java.nio.charset.StandardCharsets.UTF_8));
            int count = 0;
            while (scripts.find()) {
                String relative = scripts.group(1);
                Path file = build.resolve(relative).normalize();
                assertTrue(file.startsWith(build));
                assertArrayEquals(
                        Files.readAllBytes(file), get(port, "/plugin-preview/" + relative));
                count++;
            }
            assertTrue(count > 0, "Plugin must have JavaScript entry resources");
            if ("true".equals(System.getenv("DUOWEI_TEST_REAL_BROWSER"))) {
                org.openqa.selenium.chrome.ChromeOptions options =
                        new org.openqa.selenium.chrome.ChromeOptions();
                options.addArguments(
                        "--headless=new",
                        "--no-sandbox",
                        "--disable-dev-shm-usage",
                        "--window-size=1440,1000");
                String binary = System.getenv("DUOWEI_CHROMIUM_EXECUTABLE_PATH");
                if (binary != null && !binary.isEmpty()) options.setBinary(binary);
                org.openqa.selenium.logging.LoggingPreferences logging =
                        new org.openqa.selenium.logging.LoggingPreferences();
                logging.enable(
                        org.openqa.selenium.logging.LogType.BROWSER, java.util.logging.Level.ALL);
                options.setCapability("goog:loggingPrefs", logging);
                org.openqa.selenium.chrome.ChromeDriver driver =
                        new org.openqa.selenium.chrome.ChromeDriver(options);
                Path evidence =
                        Files.createDirectories(Paths.get("target", "plugin-preview-browser"));
                try {
                    driver.get("http://127.0.0.1:" + port + "/plugin-preview/index.html");
                    try {
                        new org.openqa.selenium.support.ui.WebDriverWait(
                                        driver, java.time.Duration.ofSeconds(20))
                                .until(
                                        d ->
                                                ((Number)
                                                                        ((org.openqa.selenium
                                                                                                .JavascriptExecutor)
                                                                                        d)
                                                                                .executeScript(
                                                                                        "return document.querySelector('#app')?.childElementCount || 0"))
                                                                .intValue()
                                                        > 0);
                        Thread.sleep(3000);
                        assertEquals("多维打印", driver.getTitle());
                    } finally {
                        Files.write(
                                evidence.resolve("page.png"),
                                driver.getScreenshotAs(org.openqa.selenium.OutputType.BYTES));
                        Files.write(
                                evidence.resolve("body.txt"),
                                driver.findElement(org.openqa.selenium.By.tagName("body"))
                                        .getText()
                                        .getBytes(java.nio.charset.StandardCharsets.UTF_8));
                        Files.write(
                                evidence.resolve("console.txt"),
                                driver.manage()
                                        .logs()
                                        .get(org.openqa.selenium.logging.LogType.BROWSER)
                                        .getAll()
                                        .toString()
                                        .getBytes(java.nio.charset.StandardCharsets.UTF_8));
                    }
                } finally {
                    driver.quit();
                }
            }
        }
    }
}
