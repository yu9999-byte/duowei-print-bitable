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
        RenderService renderer =
                new RenderService(new AutomationConfiguration(config)) {
                    @Override
                    protected org.openqa.selenium.chrome.ChromeDriver createDriver(
                            org.openqa.selenium.chrome.ChromeOptions options) {
                        return new org.openqa.selenium.chrome.ChromeDriver(options) {
                            @Override
                            public void quit() {
                                System.out.println(
                                        "RENDER_DIAGNOSTIC="
                                                + executeScript(
                                                        "const d=document.querySelector('print-designer');return {pages:d.getTemplateData().pages.length,domPages:d.shadowRoot.querySelectorAll('.print-page').length,text:d.shadowRoot.textContent.slice(-500)}"));
                                super.quit();
                            }
                        };
                    }
                };
        try {
            for (String type : new String[] {"pdf", "png"}) {
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
