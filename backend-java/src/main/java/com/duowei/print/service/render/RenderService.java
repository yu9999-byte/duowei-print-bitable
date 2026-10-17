package com.duowei.print.service.render;

import com.duowei.print.security.Protocol;
import com.fasterxml.jackson.databind.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import org.openqa.selenium.*;
import org.openqa.selenium.chrome.*;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.*;

@Service
public class RenderService {
    private final com.duowei.print.config.AutomationConfiguration configuration;

    public RenderService(com.duowei.print.config.AutomationConfiguration configuration) {
        this.configuration = configuration;
    }

    private final java.util.concurrent.ConcurrentMap<String, ChromeDriver> active =
            new java.util.concurrent.ConcurrentHashMap<>();
    private final Object lifecycle = new Object();
    private boolean closed;

    public void cancel(String artifactKey) {
        ChromeDriver driver = active.remove(artifactKey);
        if (driver != null)
            try {
                driver.quit();
            } catch (RuntimeException ignored) {
            }
    }

    @javax.annotation.PreDestroy
    public void close() {
        synchronized (lifecycle) {
            closed = true;
            for (String key : active.keySet()) cancel(key);
        }
    }

    public static class Artifact {
        public byte[] bytes;
        public String fileName, contentType, artifactKey;
        public int pageCount;
    }

    protected ChromeDriver createDriver(ChromeOptions options) {
        return new ChromeDriver(options);
    }

    public Artifact render(JsonNode body) {
        synchronized (lifecycle) {
            if (closed) throw new IllegalStateException("渲染服务已关闭");
        }
        String type = Protocol.required(body.path("output"), "type");
        if (!Arrays.asList("pdf", "png").contains(type))
            throw new IllegalArgumentException("输出格式无效");
        if ("png".equals(type) && body.path("output").path("pageLimit").asInt() != 1
                || "pdf".equals(type) && !body.path("output").path("pageLimit").isNull())
            throw new IllegalArgumentException("输出页数无效");
        Protocol.required(body, "artifactKey");
        Protocol.required(body.path("template"), "id");
        Protocol.required(body.path("template"), "revision");
        Protocol.safeSnapshot(body.path("template").path("snapshot"));
        if (!body.path("values").isObject()) throw new IllegalArgumentException("渲染变量必须是对象");
        Protocol.safeSnapshot(body.path("values"));
        ChromeOptions options = new ChromeOptions();
        options.addArguments("--headless=new", "--disable-dev-shm-usage");
        String binary = System.getenv("DUOWEI_CHROMIUM_EXECUTABLE_PATH");
        if (binary != null && !binary.isEmpty()) options.setBinary(binary);
        ChromeDriver driver;
        try {
            driver = createDriver(options);
        } catch (RuntimeException error) {
            throw launchFailure(error);
        }
        try {
            synchronized (lifecycle) {
                if (closed) throw new IllegalStateException("渲染服务已关闭");
                active.put(body.path("artifactKey").asText(), driver);
            }
            // Cancellation can arrive while ChromeDriver is still starting, before registration.
            if (Thread.currentThread().isInterrupted()) throw new IllegalStateException("生成文件已取消");
            driver.manage().timeouts().pageLoadTimeout(Duration.ofSeconds(30));
            driver.manage().timeouts().scriptTimeout(Duration.ofSeconds(90));
            driver.executeCdpCommand("Network.enable", Collections.emptyMap());
            Map<String, Object> headers = new HashMap<>();
            headers.put("Authorization", configuration.required("DUOWEI_SERVICE_AUTHORIZATION"));
            driver.executeCdpCommand(
                    "Network.setExtraHTTPHeaders", Collections.singletonMap("headers", headers));
            driver.get(configuration.required("DUOWEI_RENDER_PAGE_URL"));
            new org.openqa.selenium.support.ui.WebDriverWait(driver, Duration.ofSeconds(30))
                    .until(
                            browser ->
                                    Boolean.TRUE.equals(
                                            ((JavascriptExecutor) browser)
                                                    .executeScript(
                                                            "return Boolean(window.__DUOWEI_AUTOMATION_RENDERER__)")));
            Object value =
                    driver.executeAsyncScript(
                            "const done=arguments[arguments.length-1];const input=JSON.parse(arguments[0]); Promise.resolve().then(()=>{if(!window.__DUOWEI_AUTOMATION_RENDERER__)throw Error('Renderer unavailable');return window.__DUOWEI_AUTOMATION_RENDERER__.render(input)}).then(v=>done({ok:true,value:v}),e=>done({ok:false}));",
                            body.toString());
            JsonNode result = Protocol.JSON.valueToTree(value);
            if (!result.path("ok").asBoolean()) throw new IllegalStateException("浏览器渲染失败");
            JsonNode a = result.path("value");
            validateEnvelope(a);
            Artifact artifact = new Artifact();
            artifact.fileName = Protocol.required(a, "fileName");
            artifact.contentType = Protocol.required(a, "contentType");
            artifact.artifactKey = Protocol.required(a, "artifactKey");
            artifact.pageCount = a.path("pageCount").asInt();
            artifact.bytes = new byte[a.path("bytes").size()];
            for (int i = 0; i < artifact.bytes.length; i++)
                artifact.bytes[i] = (byte) a.path("bytes").get(i).asInt();
            if (!body.path("artifactKey").asText().equals(artifact.artifactKey)
                    || artifact.pageCount < 1
                    || artifact.bytes.length == 0) throw new IllegalStateException("渲染产物无效");
            if ("pdf".equals(type)) {
                if (!"application/pdf".equals(artifact.contentType)
                        || !artifact.fileName.toLowerCase(Locale.ROOT).endsWith(".pdf")
                        || !new String(
                                        artifact.bytes,
                                        0,
                                        Math.min(5, artifact.bytes.length),
                                        StandardCharsets.US_ASCII)
                                .equals("%PDF-")) throw new IllegalStateException("PDF产物无效");
            } else if (!"image/png".equals(artifact.contentType)
                    || artifact.pageCount != 1
                    || !artifact.fileName.toLowerCase(Locale.ROOT).endsWith(".png")
                    || artifact.bytes.length < 8
                    || !Arrays.equals(
                            Arrays.copyOf(artifact.bytes, 8),
                            new byte[] {(byte) 137, 80, 78, 71, 13, 10, 26, 10}))
                throw new IllegalStateException("PNG产物无效");
            return artifact;
        } finally {
            active.remove(body.path("artifactKey").asText(), driver);
            try {
                driver.quit();
            } catch (RuntimeException ignored) {
                // Cleanup must not replace the original rendering failure.
            }
        }
    }

    public static void validateEnvelope(JsonNode a) {
        if (!a.path("protocolVersion").isNumber()
                || a.path("protocolVersion").doubleValue() != 1.0
                || !a.path("bytes").isArray()
                || !a.path("pageCount").isNumber()
                || a.path("pageCount").doubleValue() != a.path("pageCount").asInt())
            throw new IllegalStateException("浏览器渲染协议版本不兼容");
    }

    public static IllegalStateException launchFailure(RuntimeException error) {
        String raw =
                error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
        StringJoiner actionable = new StringJoiner(" | ");
        for (String line : raw.split("[\\r\\n]+")) {
            if (line.matches(
                    "(?i).*?(error while loading shared libraries|version .+ not found|not found \\(required by|exitCode=|signal=).*"))
                actionable.add(line.trim());
        }
        String details = actionable.length() == 0 ? raw : actionable.toString();
        // Redact before truncation so a cut cannot reveal part of a credential.
        details = details.replaceAll("(?i)Bearer\\s+\\S+", "Bearer [已隐藏]");
        details = details.substring(Math.max(0, details.length() - 400));
        return new IllegalStateException(
                "Chromium启动失败（platform="
                        + System.getProperty("os.name")
                        + ", arch="
                        + System.getProperty("os.arch")
                        + "）："
                        + com.duowei.print.exception.SafeMessages.sanitize(details));
    }
}
