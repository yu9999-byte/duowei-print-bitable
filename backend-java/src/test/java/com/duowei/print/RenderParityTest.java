package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;

import com.duowei.print.config.AutomationConfiguration;
import com.duowei.print.security.Protocol;
import com.duowei.print.service.render.RenderService;
import com.fasterxml.jackson.databind.JsonNode;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.util.StreamUtils;

/** Same-input artifact comparison against original Playwright output, not a Feishu-host test. */
@EnabledIfEnvironmentVariable(named = "DUOWEI_TEST_RENDER_PARITY_DIRECTORY", matches = ".+")
class RenderParityTest {
    @Test
    void javaArtifactsMatchOriginalRuntimeMetadataAndPngPixels() throws Exception {
        Path inputDirectory =
                Paths.get(System.getenv("DUOWEI_TEST_RENDER_PARITY_DIRECTORY")).toAbsolutePath();
        Path directory =
                Files.createDirectories(
                        Paths.get("target", "render-parity-runs", UUID.randomUUID().toString()));
        for (String name :
                Arrays.asList(
                        "request-pdf.json",
                        "request-png.json",
                        "original.png",
                        "original-pdf-metadata.json",
                        "original-png-metadata.json")) {
            Files.copy(inputDirectory.resolve(name), directory.resolve(name));
        }
        if (Files.isRegularFile(inputDirectory.resolve("original.pdf"))) {
            Files.copy(inputDirectory.resolve("original.pdf"), directory.resolve("original.pdf"));
        }
        Files.write(
                directory.resolve("input-source.txt"),
                Arrays.asList(inputDirectory.toString()),
                StandardCharsets.UTF_8);
        byte[] html;
        try (java.io.InputStream stream = getClass().getResourceAsStream("/renderer.html")) {
            html = StreamUtils.copyToByteArray(stream);
        }
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/renderer",
                exchange -> {
                    try {
                        if (!"Bearer local-parity-test"
                                .equals(exchange.getRequestHeaders().getFirst("Authorization"))) {
                            exchange.sendResponseHeaders(401, -1);
                            return;
                        }
                        exchange.getResponseHeaders()
                                .set("Content-Type", "text/html;charset=UTF-8");
                        exchange.sendResponseHeaders(200, html.length);
                        exchange.getResponseBody().write(html);
                    } finally {
                        exchange.close();
                    }
                });
        server.start();
        Map<String, String> config = new HashMap<>();
        config.put("DUOWEI_SERVICE_AUTHORIZATION", "Bearer local-parity-test");
        config.put(
                "DUOWEI_RENDER_PAGE_URL",
                "http://127.0.0.1:" + server.getAddress().getPort() + "/renderer");
        List<Double> launchTimes = new ArrayList<>();
        List<Long> browserPids = new ArrayList<>();
        RenderService renderer =
                new RenderService(new AutomationConfiguration(config)) {
                    @Override
                    protected org.openqa.selenium.chrome.ChromeDriver createDriver(
                            org.openqa.selenium.chrome.ChromeOptions options) {
                        long started = System.nanoTime();
                        org.openqa.selenium.chrome.ChromeDriver driver =
                                super.createDriver(options);
                        launchTimes.add((System.nanoTime() - started) / 1000000.0);
                        Object pid = driver.getCapabilities().getCapability("goog:processID");
                        assertTrue(
                                pid instanceof Number, "Chrome must expose its owned process ID");
                        browserPids.add(((Number) pid).longValue());
                        return driver;
                    }
                };
        List<String> results = new ArrayList<>();
        com.fasterxml.jackson.databind.node.ArrayNode timings = Protocol.JSON.createArrayNode();
        int repetitions =
                Integer.parseInt(
                        System.getenv().getOrDefault("DUOWEI_RENDER_BENCHMARK_REPETITIONS", "1"));
        assertTrue(repetitions >= 1 && repetitions <= 100);
        try {
            for (String type : Arrays.asList("pdf", "png")) {
                JsonNode request =
                        Protocol.JSON.readTree(
                                Files.readAllBytes(directory.resolve("request-" + type + ".json")));
                RenderService.Artifact artifact = null;
                for (int iteration = 0; iteration < repetitions; iteration++) {
                    long started = System.nanoTime();
                    artifact = renderer.render(request);
                    double elapsed = (System.nanoTime() - started) / 1000000.0;
                    long browserPid = browserPids.get(browserPids.size() - 1);
                    boolean checkExit =
                            "true".equals(System.getenv("DUOWEI_TEST_RENDER_PROCESS_EXIT"));
                    if (checkExit) assertBrowserExited(browserPid);
                    timings.addObject()
                            .put("type", type)
                            .put("iteration", iteration)
                            .put("elapsedMs", elapsed)
                            .put("bytes", artifact.bytes.length)
                            .put("browserPid", browserPid)
                            .put("browserExitChecked", checkExit)
                            .put(
                                    "usedHeapBytes",
                                    java.lang.management.ManagementFactory.getMemoryMXBean()
                                            .getHeapMemoryUsage()
                                            .getUsed())
                            .put("driverLaunchMs", launchTimes.get(launchTimes.size() - 1));
                    Files.write(
                            directory.resolve("java-timings.json"),
                            Protocol.JSON
                                    .writerWithDefaultPrettyPrinter()
                                    .writeValueAsBytes(timings));
                }
                Files.write(
                        directory.resolve("java-timings.json"),
                        Protocol.JSON.writerWithDefaultPrettyPrinter().writeValueAsBytes(timings));
                Files.write(directory.resolve("java." + type), artifact.bytes);
                JsonNode expected =
                        Protocol.JSON.readTree(
                                Files.readAllBytes(
                                        directory.resolve("original-" + type + "-metadata.json")));
                assertEquals(expected.path("artifactKey").asText(), artifact.artifactKey);
                assertEquals(expected.path("contentType").asText(), artifact.contentType);
                assertEquals(expected.path("fileName").asText(), artifact.fileName);
                assertEquals(expected.path("pageCount").intValue(), artifact.pageCount);
                results.add(type + " metadata: identical; pages=" + artifact.pageCount);
            }
            java.awt.image.BufferedImage original =
                    javax.imageio.ImageIO.read(directory.resolve("original.png").toFile());
            java.awt.image.BufferedImage javaImage =
                    javax.imageio.ImageIO.read(directory.resolve("java.png").toFile());
            assertEquals(original.getWidth(), javaImage.getWidth());
            assertEquals(original.getHeight(), javaImage.getHeight());
            long different = 0;
            for (int y = 0; y < original.getHeight(); y++)
                for (int x = 0; x < original.getWidth(); x++)
                    if (original.getRGB(x, y) != javaImage.getRGB(x, y)) different++;
            results.add(
                    "PNG different pixels="
                            + different
                            + "/"
                            + ((long) original.getWidth() * original.getHeight()));
            Files.write(directory.resolve("java-result.txt"), results, StandardCharsets.UTF_8);
            assertEquals(
                    0, different, "Same browser binary and input must render identical PNG pixels");
        } finally {
            renderer.close();
            server.stop(0);
        }
    }

    private static void assertBrowserExited(long pid) throws Exception {
        assertTrue(System.getProperty("os.name").startsWith("Windows"));
        assertTrue(pid > 0);
        Process probe =
                new ProcessBuilder(
                                "powershell.exe",
                                "-NoProfile",
                                "-NonInteractive",
                                "-Command",
                                "if (Get-Process -Id "
                                        + pid
                                        + " -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }")
                        .redirectErrorStream(true)
                        .start();
        assertTrue(probe.waitFor(10, java.util.concurrent.TimeUnit.SECONDS));
        assertEquals(0, probe.exitValue(), "Owned browser main process remains alive: " + pid);
    }
}
