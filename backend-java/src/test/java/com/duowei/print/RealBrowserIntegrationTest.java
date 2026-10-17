package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;

import com.duowei.print.config.AutomationConfiguration;
import com.duowei.print.security.Protocol;
import com.duowei.print.service.render.RenderService;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.util.StreamUtils;

@EnabledIfEnvironmentVariable(named = "DUOWEI_TEST_REAL_BROWSER", matches = "true")
class RealBrowserIntegrationTest {
    @Test
    void realChromeTimeoutClosesSessionAndAllowsSameKeyRetry() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        java.util.concurrent.atomic.AtomicBoolean hang =
                new java.util.concurrent.atomic.AtomicBoolean(true);
        java.util.concurrent.CountDownLatch entered = new java.util.concurrent.CountDownLatch(1);
        server.createContext(
                "/renderer",
                exchange -> {
                    String script =
                            hang.get()
                                    ? "render:()=>{fetch('/entered');return new Promise(()=>{})}"
                                    : "render:r=>({protocolVersion:1,artifactKey:r.artifactKey,fileName:'retry.pdf',contentType:'application/pdf',pageCount:1,bytes:[37,80,68,70,45]})";
                    byte[] html =
                            ("<script>window.__DUOWEI_AUTOMATION_RENDERER__={"
                                            + script
                                            + "}</script>")
                                    .getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().set("Content-Type", "text/html;charset=UTF-8");
                    exchange.sendResponseHeaders(200, html.length);
                    exchange.getResponseBody().write(html);
                    exchange.close();
                });
        server.createContext(
                "/entered",
                exchange -> {
                    entered.countDown();
                    exchange.sendResponseHeaders(204, -1);
                    exchange.close();
                });
        server.start();
        Map<String, String> config = new HashMap<>();
        config.put("DUOWEI_SERVICE_AUTHORIZATION", "Bearer local-browser-test");
        config.put(
                "DUOWEI_RENDER_PAGE_URL",
                "http://127.0.0.1:" + server.getAddress().getPort() + "/renderer");
        java.util.List<org.openqa.selenium.chrome.ChromeDriver> drivers =
                new java.util.concurrent.CopyOnWriteArrayList<>();
        java.util.List<Long> browserPids = new java.util.concurrent.CopyOnWriteArrayList<>();
        RenderService renderer =
                new RenderService(new AutomationConfiguration(config)) {
                    @Override
                    protected org.openqa.selenium.chrome.ChromeDriver createDriver(
                            org.openqa.selenium.chrome.ChromeOptions options) {
                        org.openqa.selenium.chrome.ChromeDriver driver =
                                super.createDriver(options);
                        drivers.add(driver);
                        Object pid = driver.getCapabilities().getCapability("goog:processID");
                        assertTrue(
                                pid instanceof Number, "ChromeDriver must expose its browser PID");
                        browserPids.add(((Number) pid).longValue());
                        return driver;
                    }
                };
        com.duowei.print.service.render.RenderCache cache =
                new com.duowei.print.service.render.RenderCache(renderer, 8000);
        try {
            com.fasterxml.jackson.databind.JsonNode request =
                    Protocol.JSON.readTree(
                            "{\"artifactKey\":\"duowei:v1:timeout-retry\",\"template\":{\"id\":\"test\",\"revision\":\"r1\",\"snapshot\":{}},\"values\":{},\"output\":{\"type\":\"pdf\",\"pageLimit\":null}}");
            IllegalStateException failure =
                    assertThrows(IllegalStateException.class, () -> cache.render(request));
            assertTrue(failure.getMessage().contains("超时"));
            assertEquals(
                    0, entered.getCount(), "Chrome must reach the hanging renderer before timeout");
            long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(10);
            while (drivers.get(0).getSessionId() != null && System.nanoTime() < deadline)
                Thread.sleep(50);
            assertNull(drivers.get(0).getSessionId());
            assertBrowserExitedOnWindows(browserPids.get(0));
            hang.set(false);
            assertEquals("duowei:v1:timeout-retry", cache.render(request).artifactKey);
            assertEquals(2, drivers.size());
            assertNull(drivers.get(1).getSessionId());
            assertBrowserExitedOnWindows(browserPids.get(1));
        } finally {
            cache.close();
            renderer.close();
            server.stop(0);
        }
    }

    private void assertBrowserExitedOnWindows(long pid) throws Exception {
        if (!System.getProperty("os.name").startsWith("Windows")) return;
        long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(10);
        boolean alive;
        do {
            Process query =
                    new ProcessBuilder("tasklist.exe", "/FI", "PID eq " + pid, "/FO", "CSV", "/NH")
                            .redirectErrorStream(true)
                            .start();
            assertTrue(
                    query.waitFor(5, java.util.concurrent.TimeUnit.SECONDS),
                    "PID query must finish");
            assertEquals(0, query.exitValue());
            String output;
            try (java.io.InputStream stream = query.getInputStream()) {
                output =
                        new String(
                                StreamUtils.copyToByteArray(stream),
                                java.nio.charset.StandardCharsets.UTF_8);
            }
            alive = output.contains("\",\"" + pid + "\",");
            if (alive) Thread.sleep(100);
        } while (alive && System.nanoTime() < deadline);
        assertFalse(alive, "Chrome browser process must exit: " + pid);
    }

    @Test
    void bundledEngineProducesPdfAndPngThroughChromeDriver() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        byte[] html;
        try (java.io.InputStream input = getClass().getResourceAsStream("/renderer.html")) {
            html = StreamUtils.copyToByteArray(input);
        }
        server.createContext(
                "/renderer",
                exchange -> {
                    try {
                        if (!"Bearer local-browser-test"
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
        config.put("DUOWEI_SERVICE_AUTHORIZATION", "Bearer local-browser-test");
        config.put(
                "DUOWEI_RENDER_PAGE_URL",
                "http://127.0.0.1:" + server.getAddress().getPort() + "/renderer");
        RenderService renderer = new RenderService(new AutomationConfiguration(config));
        try {
            for (String type : new String[] {"png", "pdf"}) {
                com.fasterxml.jackson.databind.node.ObjectNode request =
                        (com.fasterxml.jackson.databind.node.ObjectNode)
                                Protocol.JSON.readTree(
                                        "{\"artifactKey\":\"duowei:v1:real-"
                                                + type
                                                + "\",\"template\":{\"id\":\"real\",\"revision\":\"r1\",\"snapshot\":{\"canvasSize\":{\"width\":600,\"height\":800},\"pages\":[{\"elements\":[]}]}},\"values\":{},\"output\":{\"type\":\""
                                                + type
                                                + "\",\"pageLimit\":"
                                                + ("pdf".equals(type) ? "null" : "1")
                                                + "}}");
                com.fasterxml.jackson.databind.node.ArrayNode pages =
                        (com.fasterxml.jackson.databind.node.ArrayNode)
                                request.path("template").path("snapshot").path("pages");
                com.fasterxml.jackson.databind.node.ObjectNode text =
                        ((com.fasterxml.jackson.databind.node.ArrayNode)
                                        pages.get(0).path("elements"))
                                .addObject();
                text.put("id", "summary")
                        .put("type", "text")
                        .put("x", 40)
                        .put("y", 40)
                        .put("width", 500)
                        .put("height", 100)
                        .put("fontSize", 32)
                        .put("content", "Order: @__duowei_field_order")
                        .put("variable", "@__duowei_field_order");
                text.putObject("style")
                        .put("zIndex", 1)
                        .put("fontSize", 32)
                        .put("fontFamily", "Arial")
                        .put("color", "#000000");
                pages.add(pages.get(0).deepCopy());
                ((com.fasterxml.jackson.databind.node.ObjectNode) pages.get(0))
                        .put("id", "page-one");
                ((com.fasterxml.jackson.databind.node.ObjectNode) pages.get(1))
                        .put("id", "page-two");
                ((com.fasterxml.jackson.databind.node.ObjectNode)
                                pages.get(1).path("elements").get(0))
                        .put("id", "summary-two");
                ((com.fasterxml.jackson.databind.node.ObjectNode) request.path("values"))
                        .put("order", "SO-001");
                RenderService.Artifact artifact = renderer.render(request);
                assertTrue(artifact.bytes.length > 100);
                assertTrue(artifact.pageCount >= 1);
                if ("png".equals(type)) {
                    java.awt.image.BufferedImage image =
                            javax.imageio.ImageIO.read(
                                    new java.io.ByteArrayInputStream(artifact.bytes));
                    assertNotNull(image);
                    assertEquals(600, image.getWidth());
                    assertEquals(800, image.getHeight());
                    ((com.fasterxml.jackson.databind.node.ObjectNode) request.path("values"))
                            .put("order", "XXXXXXXX");
                    request.put("artifactKey", "duowei:v1:real-png-second-value");
                    java.awt.image.BufferedImage changed =
                            javax.imageio.ImageIO.read(
                                    new java.io.ByteArrayInputStream(
                                            renderer.render(request).bytes));
                    int differences = 0;
                    for (int y = 0; y < image.getHeight(); y++)
                        for (int x = 0; x < image.getWidth(); x++)
                            if (image.getRGB(x, y) != changed.getRGB(x, y)) differences++;
                    assertTrue(
                            differences > 20,
                            "Changing a stable field value must change rendered pixels");
                } else {
                    String pdf =
                            new String(
                                    artifact.bytes, java.nio.charset.StandardCharsets.ISO_8859_1);
                    assertTrue(pdf.trim().endsWith("%%EOF"));
                    assertEquals(2, artifact.pageCount);
                }
                java.nio.file.Files.write(
                        java.nio.file.Paths.get("target", "real-browser." + type), artifact.bytes);
            }
        } finally {
            renderer.close();
            server.stop(0);
        }
    }
}
