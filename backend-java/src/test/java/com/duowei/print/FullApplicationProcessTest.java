package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;

import com.duowei.print.security.Protocol;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.util.StreamUtils;

/**
 * Boots the production main class in a separate JVM without test configuration on its classpath.
 */
class FullApplicationProcessTest {
    private static class Result {
        int status;
        byte[] bytes;
        Map<String, List<String>> headers;
    }

    private Result request(int port, String path, String bearer) throws Exception {
        HttpURLConnection connection =
                (HttpURLConnection) new URL("http://127.0.0.1:" + port + path).openConnection();
        connection.setConnectTimeout(1000);
        connection.setReadTimeout(10000);
        if (bearer != null) connection.setRequestProperty("Authorization", bearer);
        try {
            Result result = new Result();
            result.status = connection.getResponseCode();
            result.headers = connection.getHeaderFields();
            java.io.InputStream stream =
                    result.status >= 400
                            ? connection.getErrorStream()
                            : connection.getInputStream();
            result.bytes = stream == null ? new byte[0] : StreamUtils.copyToByteArray(stream);
            return result;
        } finally {
            connection.disconnect();
        }
    }

    private Result registry(int port, com.fasterxml.jackson.databind.JsonNode fixture)
            throws Exception {
        return json(port, "/api/automation/registry", fixture);
    }

    private Result json(int port, String path, com.fasterxml.jackson.databind.JsonNode fixture)
            throws Exception {
        HttpURLConnection connection =
                (HttpURLConnection) new URL("http://127.0.0.1:" + port + path).openConnection();
        connection.setConnectTimeout(1000);
        connection.setReadTimeout(10000);
        connection.setRequestMethod("POST");
        if (path.endsWith("background-jobs"))
            connection.setRequestProperty(
                    "x-duowei-tenant-access-token", "isolated-token-long-enough");
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty(
                "x-duowei-service-signature", fixture.path("signature").asText());
        connection.setDoOutput(true);
        try {
            try (java.io.OutputStream out = connection.getOutputStream()) {
                out.write(Protocol.JSON.writeValueAsBytes(fixture.path("body")));
            }
            Result result = new Result();
            result.status = connection.getResponseCode();
            result.headers = connection.getHeaderFields();
            java.io.InputStream stream =
                    result.status >= 400
                            ? connection.getErrorStream()
                            : connection.getInputStream();
            result.bytes = stream == null ? new byte[0] : StreamUtils.copyToByteArray(stream);
            return result;
        } finally {
            connection.disconnect();
        }
    }

    @Test
    void productionMainServesHealthAndActualPluginWhileProtectingRenderer() throws Exception {
        int port;
        try (java.net.ServerSocket socket =
                new java.net.ServerSocket(0, 0, InetAddress.getLoopbackAddress())) {
            port = socket.getLocalPort();
        }
        Path evidence =
                Files.createDirectories(
                        Paths.get("target", "full-application", UUID.randomUUID().toString()));
        String classpath =
                Arrays.stream(
                                System.getProperty(
                                                "surefire.test.class.path",
                                                System.getProperty("java.class.path"))
                                        .split(
                                                java.util.regex.Pattern.quote(
                                                        java.io.File.pathSeparator)))
                        .filter(
                                entry ->
                                        !Paths.get(entry)
                                                .toAbsolutePath()
                                                .normalize()
                                                .equals(
                                                        Paths.get("target/test-classes")
                                                                .toAbsolutePath()
                                                                .normalize()))
                        .collect(java.util.stream.Collectors.joining(java.io.File.pathSeparator));
        Path javaBinary =
                Paths.get(
                        System.getProperty("java.home"),
                        "bin",
                        System.getProperty("os.name").startsWith("Windows") ? "java.exe" : "java");
        Path plugin = Paths.get("../record-view/dist").toAbsolutePath().normalize();
        String packagedJar = System.getProperty("duowei.test.packagedJar");
        List<String> command = new ArrayList<>();
        command.add(javaBinary.toString());
        if (packagedJar == null) {
            command.addAll(Arrays.asList("-cp", classpath, "com.duowei.print.PrintApplication"));
        } else {
            Path jar = Paths.get(packagedJar).toAbsolutePath().normalize();
            assertTrue(Files.isRegularFile(jar), "Packaged JAR must exist before this test");
            command.addAll(Arrays.asList("-jar", jar.toString()));
        }
        command.add("--server.address=127.0.0.1");
        command.add("--duowei.plugin-preview-directory=" + plugin);
        ProcessBuilder builder = new ProcessBuilder(command);
        Map<String, String> env = builder.environment();
        env.put("PORT", String.valueOf(port));
        env.put("DUOWEI_DATABASE_URL", "jdbc:postgresql://127.0.0.1:1/local_startup_only");
        env.put("DUOWEI_DATABASE_USERNAME", "local-test");
        env.put("DUOWEI_DATABASE_PASSWORD", "local-test");
        env.put("DUOWEI_SERVICE_AUTHORIZATION", "Bearer isolated-startup-test");
        env.put("DUOWEI_FEISHU_APP_ID", "cli_localtest");
        env.put("DUOWEI_FEISHU_APP_SECRET", "local-test");
        env.put("DUOWEI_EVENT_VERIFICATION_TOKEN", "local-test");
        for (String name :
                Arrays.asList(
                        "DUOWEI_REGISTRY_WRITE_SIGNING_SECRET_HEX",
                        "DUOWEI_REGISTRY_READ_SIGNING_SECRET_HEX",
                        "DUOWEI_RENDERER_SIGNING_SECRET_HEX",
                        "DUOWEI_BACKGROUND_JOB_SIGNING_SECRET_HEX"))
            env.put(name, String.join("", Collections.nCopies(64, "0")));
        String base = "http://127.0.0.1:" + port;
        env.put("DUOWEI_PUBLIC_AUTOMATION_BASE_URL", base + "/openapi/duowei-print");
        env.put("DUOWEI_OAUTH_REDIRECT_URI", base + "/api/automation/oauth/callback");
        env.put("DUOWEI_RENDER_PAGE_URL", base + "/openapi/duowei-print/renderer");
        env.put("DUOWEI_ALLOWED_ORIGINS", "https://plugin.example");
        env.put("DUOWEI_ALLOW_INSECURE_LOCAL_RENDERER", "true");
        env.put("DUOWEI_BACKGROUND_WORKER_INTERVAL_MS", "60000");
        org.springframework.jdbc.datasource.SingleConnectionDataSource database = null;
        org.springframework.jdbc.core.JdbcTemplate jdbc = null;
        String schema = "duowei_test_" + UUID.randomUUID().toString().replace("-", "");
        String databaseUrl = System.getenv("DUOWEI_TEST_POSTGRES_URL");
        if (databaseUrl != null) {
            database =
                    new org.springframework.jdbc.datasource.SingleConnectionDataSource(
                            databaseUrl,
                            System.getenv("DUOWEI_TEST_POSTGRES_USERNAME"),
                            System.getenv("DUOWEI_TEST_POSTGRES_PASSWORD"),
                            true);
            jdbc = new org.springframework.jdbc.core.JdbcTemplate(database);
            jdbc.execute("CREATE SCHEMA " + schema);
            jdbc.execute("SET search_path TO " + schema);
            for (String migration :
                    Arrays.asList(
                            "0001_duowei_automation_template.sql",
                            "0002_duowei_automation_background.sql"))
                jdbc.execute(
                        new String(
                                Files.readAllBytes(Paths.get("migrations", migration)),
                                StandardCharsets.UTF_8));
            env.put(
                    "DUOWEI_DATABASE_URL",
                    databaseUrl
                            + (databaseUrl.contains("?") ? "&" : "?")
                            + "currentSchema="
                            + schema);
            env.put("DUOWEI_DATABASE_USERNAME", System.getenv("DUOWEI_TEST_POSTGRES_USERNAME"));
            env.put("DUOWEI_DATABASE_PASSWORD", System.getenv("DUOWEI_TEST_POSTGRES_PASSWORD"));
        }
        Process process =
                builder.redirectErrorStream(true)
                        .redirectOutput(evidence.resolve("application.log").toFile())
                        .start();
        try {
            Result health = null;
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(40);
            while (process.isAlive() && System.nanoTime() < deadline) {
                try {
                    health = request(port, "/openapi/duowei-print/health", null);
                    if (health.status == 200) break;
                } catch (java.io.IOException ignored) {
                }
                Thread.sleep(100);
            }
            assertNotNull(health, "Application did not become reachable; see application.log");
            assertEquals(200, health.status);
            assertEquals(
                    1, Protocol.JSON.readTree(health.bytes).path("protocolVersion").intValue());
            Result html = request(port, "/plugin-preview/index.html", null);
            assertEquals(200, html.status);
            assertArrayEquals(Files.readAllBytes(plugin.resolve("index.html")), html.bytes);
            assertEquals(401, request(port, "/openapi/duowei-print/renderer", null).status);
            Result renderer =
                    request(port, "/openapi/duowei-print/renderer", "Bearer isolated-startup-test");
            assertEquals(200, renderer.status);
            assertTrue(
                    new String(renderer.bytes, StandardCharsets.UTF_8)
                            .contains("__DUOWEI_AUTOMATION_RENDERER__"));
            if (jdbc != null) {
                for (com.fasterxml.jackson.databind.JsonNode job :
                        Protocol.JSON.readTree(
                                getClass().getResourceAsStream("/background-contracts.json"))) {
                    if (job.path("expected").path("status").intValue() < 400) continue;
                    Result rejected = json(port, "/openapi/duowei-print/background-jobs", job);
                    assertEquals(
                            job.path("expected").path("status").intValue(),
                            rejected.status,
                            job.path("id").asText());
                    com.fasterxml.jackson.databind.node.ObjectNode actual =
                            (com.fasterxml.jackson.databind.node.ObjectNode)
                                    Protocol.JSON.readTree(rejected.bytes);
                    actual.remove("traceId");
                    assertEquals(
                            job.path("expected").path("body"), actual, job.path("id").asText());
                    assertEquals(
                            0,
                            jdbc.queryForObject(
                                    "SELECT count(*) FROM duowei_automation_background_job",
                                    Integer.class));
                }
                for (com.fasterxml.jackson.databind.JsonNode event :
                        Protocol.JSON.readTree(
                                getClass().getResourceAsStream("/event-contracts.json"))) {
                    Result eventResponse = json(port, "/openapi/duowei-print/events", event);
                    assertEquals(
                            event.path("expected").path("status").intValue(),
                            eventResponse.status,
                            event.path("id").asText());
                    assertEquals(
                            event.path("expected").path("body"),
                            Protocol.JSON.readTree(eventResponse.bytes),
                            event.path("id").asText());
                    if (event.path("expected").path("savedTickets").size() > 0) {
                        assertEquals(
                                1,
                                jdbc.queryForObject(
                                        "SELECT count(*) FROM duowei_automation_app_ticket",
                                        Integer.class));
                        assertEquals(
                                event.path("expected").path("savedTickets").get(0).asText(),
                                jdbc.queryForObject(
                                        "SELECT ticket FROM duowei_automation_app_ticket WHERE app_id='cli_localtest'",
                                        String.class));
                    } else {
                        assertEquals(
                                0,
                                jdbc.queryForObject(
                                        "SELECT count(*) FROM duowei_automation_app_ticket",
                                        Integer.class));
                    }
                }
                com.fasterxml.jackson.databind.JsonNode fixtures =
                        Protocol.JSON.readTree(
                                getClass().getResourceAsStream("/registry-contracts.json"));
                com.fasterxml.jackson.databind.JsonNode write = null, read = null;
                for (com.fasterxml.jackson.databind.JsonNode fixture : fixtures) {
                    if (!fixture.has("storeOperation")) {
                        Result failure = registry(port, fixture);
                        assertEquals(
                                fixture.path("expected").path("status").intValue(),
                                failure.status,
                                fixture.path("id").asText());
                        com.fasterxml.jackson.databind.node.ObjectNode actual =
                                (com.fasterxml.jackson.databind.node.ObjectNode)
                                        Protocol.JSON.readTree(failure.bytes);
                        String trace = actual.path("traceId").asText();
                        assertFalse(trace.isEmpty());
                        List<String> traces =
                                failure.headers.entrySet().stream()
                                        .filter(
                                                e ->
                                                        "x-duowei-trace-id"
                                                                .equalsIgnoreCase(e.getKey()))
                                        .findFirst()
                                        .get()
                                        .getValue();
                        assertEquals(Collections.singletonList(trace), traces);
                        actual.remove("traceId");
                        assertEquals(
                                fixture.path("expected").path("body"),
                                actual,
                                fixture.path("id").asText());
                    }
                    if ("valid-write".equals(fixture.path("id").asText())) write = fixture;
                    if ("valid-list".equals(fixture.path("id").asText())) read = fixture;
                }
                assertNotNull(write);
                assertNotNull(read);
                assertEquals(
                        0,
                        Protocol.JSON
                                .readTree(registry(port, read).bytes)
                                .path("templates")
                                .size());
                assertEquals(204, registry(port, write).status);
                assertEquals(204, registry(port, write).status);
                assertEquals(
                        1,
                        jdbc.queryForObject(
                                "SELECT count(*) FROM duowei_automation_template", Integer.class));
                process.destroy();
                assertTrue(process.waitFor(10, TimeUnit.SECONDS));
                process =
                        builder.redirectOutput(
                                        evidence.resolve("restarted-application.log").toFile())
                                .start();
                long restartDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(40);
                Result persisted = null;
                while (process.isAlive() && System.nanoTime() < restartDeadline) {
                    try {
                        persisted = registry(port, read);
                        if (persisted.status == 200) break;
                    } catch (java.io.IOException ignored) {
                    }
                    Thread.sleep(100);
                }
                assertNotNull(persisted);
                assertEquals(200, persisted.status);
                com.fasterxml.jackson.databind.JsonNode rows =
                        Protocol.JSON.readTree(persisted.bytes).path("templates");
                assertEquals(1, rows.size());
                assertEquals(
                        write.path("body").path("template").path("name"), rows.get(0).path("name"));
                Files.write(
                        evidence.resolve("database-result.txt"),
                        Arrays.asList(
                                "real-postgres-http: passed",
                                "background-errors: 23 original HTTP cases rejected before persistence",
                                "signed-write-twice: 204, one database row",
                                "original-error-fixtures: exact HTTP status/body, single correlated trace",
                                "event-contracts: 18 original cases, actual ticket persistence including duplicates",
                                "process-restart: signed-list retains original template"),
                        StandardCharsets.UTF_8);
            }
            Files.write(
                    evidence.resolve("result.txt"),
                    Arrays.asList(
                            "production-main: reachable",
                            "launch-mode: " + (packagedJar == null ? "classpath" : "java -jar"),
                            "health: 200, protocolVersion=1",
                            "plugin-index: 200, exact original bytes",
                            "anonymous-renderer: 401",
                            "authenticated-renderer: 200",
                            databaseUrl == null
                                    ? "database: deliberately unreachable, no database business claim"
                                    : "database: real PostgreSQL, signed HTTP write/read and process restart"),
                    StandardCharsets.UTF_8);
        } finally {
            process.destroy();
            if (!process.waitFor(10, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                assertTrue(process.waitFor(10, TimeUnit.SECONDS));
            }
            if (jdbc != null) {
                try {
                    jdbc.execute("DROP SCHEMA " + schema + " CASCADE");
                } finally {
                    database.destroy();
                }
            }
        }
    }
}
