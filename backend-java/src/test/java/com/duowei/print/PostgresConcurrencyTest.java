package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.duowei.print.config.AutomationConfiguration;
import com.duowei.print.integration.feishu.FeishuClient;
import com.duowei.print.repository.BackgroundJobRepository;
import com.duowei.print.security.Protocol;
import com.duowei.print.service.job.BackgroundService;
import com.duowei.print.service.render.RenderService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** Producer concurrency only: worker is stopped deliberately, so no platform side effects occur. */
@EnabledIfEnvironmentVariable(named = "DUOWEI_TEST_POSTGRES_URL", matches = "jdbc:postgresql:.+")
class PostgresConcurrencyTest {
    @Test
    void pooledLockConnectionReleasesOnSuccessAndCallbackFailure() throws Exception {
        String url = System.getenv("DUOWEI_TEST_POSTGRES_URL");
        String user = System.getenv("DUOWEI_TEST_POSTGRES_USERNAME");
        String password = System.getenv("DUOWEI_TEST_POSTGRES_PASSWORD");
        JdbcTemplate admin = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
        String schema = "duowei_test_" + UUID.randomUUID().toString().replace("-", "");
        admin.execute("CREATE SCHEMA " + schema);
        com.zaxxer.hikari.HikariConfig config = new com.zaxxer.hikari.HikariConfig();
        config.setJdbcUrl(url + (url.contains("?") ? "&" : "?") + "currentSchema=" + schema);
        config.setUsername(user);
        config.setPassword(password);
        config.setMaximumPoolSize(2);
        config.setMinimumIdle(1);
        try (com.zaxxer.hikari.HikariDataSource pool =
                new com.zaxxer.hikari.HikariDataSource(config)) {
            BackgroundJobRepository jobs = new BackgroundJobRepository(new JdbcTemplate(pool));
            BackgroundJobRepository independent =
                    new BackgroundJobRepository(
                            new JdbcTemplate(
                                    new DriverManagerDataSource(
                                            config.getJdbcUrl(), user, password)));
            for (int iteration = 0; iteration < 3; iteration++) {
                assertTrue(
                        jobs.withWorkerLock(
                                () -> {
                                    assertFalse(
                                            independent.withWorkerLock(
                                                    () -> fail("Competing connection entered")));
                                }));
                assertTrue(
                        independent.withWorkerLock(() -> {}),
                        "Success left a pooled session holding lock");
                assertThrows(
                        IllegalArgumentException.class,
                        () ->
                                jobs.withWorkerLock(
                                        () -> {
                                            throw new IllegalArgumentException(
                                                    "pooled callback failure");
                                        }));
                assertTrue(
                        independent.withWorkerLock(() -> {}),
                        "Callback failure left pooled lock held");
                assertEquals(0, pool.getHikariPoolMXBean().getActiveConnections());
            }
            Path directory =
                    Files.createDirectories(
                            Paths.get("target/concurrency", UUID.randomUUID().toString()));
            Files.write(
                    directory.resolve("pooled-lock-result.txt"),
                    Arrays.asList(
                            "PASS: HikariCP maxPoolSize=2; three success and callback-failure cycles",
                            "Independent connection refused while held and acquires after each return",
                            "Active pooled connections=0 after every cycle",
                            "No connection-loss or transaction-proxy claim"),
                    StandardCharsets.UTF_8);
        } finally {
            admin.execute("DROP SCHEMA " + schema + " CASCADE");
        }
    }

    @Test
    void lostLockConnectionDoesNotFenceTheStillRunningCallback() throws Exception {
        String url = System.getenv("DUOWEI_TEST_POSTGRES_URL");
        String user = System.getenv("DUOWEI_TEST_POSTGRES_USERNAME");
        String password = System.getenv("DUOWEI_TEST_POSTGRES_PASSWORD");
        JdbcTemplate admin = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
        String schema = "duowei_test_" + UUID.randomUUID().toString().replace("-", "");
        String application = "lock_loss_" + UUID.randomUUID().toString().replace("-", "");
        admin.execute("CREATE SCHEMA " + schema);
        ExecutorService executor = Executors.newSingleThreadExecutor();
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        java.util.concurrent.atomic.AtomicBoolean active =
                new java.util.concurrent.atomic.AtomicBoolean();
        try {
            String scoped = url + (url.contains("?") ? "&" : "?") + "currentSchema=" + schema;
            BackgroundJobRepository owner =
                    new BackgroundJobRepository(
                            new JdbcTemplate(
                                    new DriverManagerDataSource(
                                            scoped + "&ApplicationName=" + application,
                                            user,
                                            password)));
            Future<?> running =
                    executor.submit(
                            () ->
                                    owner.withWorkerLock(
                                            () -> {
                                                active.set(true);
                                                entered.countDown();
                                                try {
                                                    assertTrue(release.await(20, TimeUnit.SECONDS));
                                                } catch (InterruptedException error) {
                                                    Thread.currentThread().interrupt();
                                                    throw new IllegalStateException(error);
                                                } finally {
                                                    active.set(false);
                                                }
                                            }));
            assertTrue(entered.await(15, TimeUnit.SECONDS));
            List<Integer> pids =
                    admin.queryForList(
                            "SELECT pid FROM pg_stat_activity WHERE application_name=?",
                            Integer.class,
                            application);
            assertEquals(
                    1, pids.size(), "Only the explicitly tagged test connection may be terminated");
            assertEquals(
                    Boolean.TRUE,
                    admin.queryForObject(
                            "SELECT pg_terminate_backend(?)", Boolean.class, pids.get(0)));
            BackgroundJobRepository contender =
                    new BackgroundJobRepository(
                            new JdbcTemplate(new DriverManagerDataSource(scoped, user, password)));
            boolean overlap = false;
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
            while (!overlap && System.nanoTime() < deadline) {
                overlap =
                        contender.withWorkerLock(
                                () ->
                                        assertTrue(
                                                active.get(),
                                                "Original callback is still active after its database session ended"));
                if (!overlap) Thread.sleep(25);
            }
            assertTrue(overlap, "Reproduce lock-loss overlap; this is not a safety acceptance");
            release.countDown();
            ExecutionException failure =
                    assertThrows(ExecutionException.class, () -> running.get(15, TimeUnit.SECONDS));
            assertTrue(failure.getCause() instanceof IllegalStateException);
            Path directory =
                    Files.createDirectories(
                            Paths.get("target/concurrency", UUID.randomUUID().toString()));
            Files.write(
                    directory.resolve("lock-loss-risk.txt"),
                    Arrays.asList(
                            "R-03 REMAINS: terminating the tagged lock session allows a second callback while first remains active",
                            "Old callback reports SQL cleanup failure only after returning",
                            "Actual PostgreSQL session loss, not physical network partition; no platform calls"),
                    StandardCharsets.UTF_8);
        } finally {
            release.countDown();
            executor.shutdownNow();
            assertTrue(executor.awaitTermination(20, TimeUnit.SECONDS));
            admin.execute("DROP SCHEMA " + schema + " CASCADE");
        }
    }

    public static class LockProbe {
        public static void main(String[] arguments) throws Exception {
            String url = System.getenv("DUOWEI_TEST_POSTGRES_URL");
            JdbcTemplate db =
                    new JdbcTemplate(
                            new DriverManagerDataSource(
                                    url
                                            + (url.contains("?") ? "&" : "?")
                                            + "currentSchema="
                                            + arguments[0],
                                    System.getenv("DUOWEI_TEST_POSTGRES_USERNAME"),
                                    System.getenv("DUOWEI_TEST_POSTGRES_PASSWORD")));
            Path directory = Paths.get(arguments[1]);
            boolean acquired =
                    new BackgroundJobRepository(db)
                            .withWorkerLock(
                                    () -> {
                                        try {
                                            Files.write(
                                                    directory.resolve("acquired"), new byte[] {1});
                                            while (!Files.exists(directory.resolve("release")))
                                                Thread.sleep(25);
                                        } catch (Exception error) {
                                            throw new IllegalStateException(error);
                                        }
                                    });
            Files.write(
                    directory.resolve("result"),
                    Boolean.toString(acquired).getBytes(StandardCharsets.UTF_8));
        }
    }

    private static Process lockProbe(String schema, Path directory) throws Exception {
        Files.createDirectories(directory);
        return new ProcessBuilder(
                        Paths.get(System.getProperty("java.home"), "bin", "java.exe").toString(),
                        "-cp",
                        System.getProperty(
                                "surefire.test.class.path", System.getProperty("java.class.path")),
                        LockProbe.class.getName(),
                        schema,
                        directory.toAbsolutePath().toString())
                .redirectErrorStream(true)
                .redirectOutput(directory.resolve("process.log").toFile())
                .start();
    }

    @Test
    void independentJvmLockSurvivesContentionAndReleasesAfterCrashAndCallbackFailure()
            throws Exception {
        String url = System.getenv("DUOWEI_TEST_POSTGRES_URL");
        String user = System.getenv("DUOWEI_TEST_POSTGRES_USERNAME");
        String password = System.getenv("DUOWEI_TEST_POSTGRES_PASSWORD");
        JdbcTemplate admin = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
        String schema = "duowei_test_" + UUID.randomUUID().toString().replace("-", "");
        admin.execute("CREATE SCHEMA " + schema);
        List<Process> children = new ArrayList<>();
        Path root =
                Files.createDirectories(
                        Paths.get("target/concurrency", UUID.randomUUID().toString()));
        try {
            Process first = lockProbe(schema, root.resolve("owner"));
            children.add(first);
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
            while (!Files.exists(root.resolve("owner/acquired"))
                    && first.isAlive()
                    && System.nanoTime() < deadline) Thread.sleep(25);
            assertTrue(Files.exists(root.resolve("owner/acquired")), "Owner did not acquire lock");
            Process second = lockProbe(schema, root.resolve("contender"));
            children.add(second);
            assertTrue(second.waitFor(20, TimeUnit.SECONDS));
            assertEquals(0, second.exitValue());
            assertEquals(
                    "false",
                    new String(
                            Files.readAllBytes(root.resolve("contender/result")),
                            StandardCharsets.UTF_8));
            assertFalse(Files.exists(root.resolve("contender/acquired")));
            first.destroyForcibly();
            assertTrue(first.waitFor(10, TimeUnit.SECONDS));
            JdbcTemplate db =
                    new JdbcTemplate(
                            new DriverManagerDataSource(
                                    url
                                            + (url.contains("?") ? "&" : "?")
                                            + "currentSchema="
                                            + schema,
                                    user,
                                    password));
            BackgroundJobRepository jobs = new BackgroundJobRepository(db);
            boolean available = false;
            deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
            while (!available && System.nanoTime() < deadline) {
                available = jobs.withWorkerLock(() -> {});
                if (!available) Thread.sleep(25);
            }
            assertTrue(available, "Killed owner left lock held");
            IllegalArgumentException failure =
                    assertThrows(
                            IllegalArgumentException.class,
                            () ->
                                    jobs.withWorkerLock(
                                            () -> {
                                                throw new IllegalArgumentException(
                                                        "fixture failure");
                                            }));
            assertEquals("fixture failure", failure.getMessage());
            Path successor = Files.createDirectories(root.resolve("successor"));
            Files.write(successor.resolve("release"), new byte[] {1});
            Process third = lockProbe(schema, successor);
            children.add(third);
            assertTrue(third.waitFor(20, TimeUnit.SECONDS));
            assertEquals(0, third.exitValue());
            assertEquals(
                    "true",
                    new String(
                            Files.readAllBytes(successor.resolve("result")),
                            StandardCharsets.UTF_8));
            Files.write(
                    root.resolve("lock-lifecycle.txt"),
                    Arrays.asList(
                            "PASS: independent JVM contender refused while owner alive",
                            "PASS: forced owner termination releases PostgreSQL session lock",
                            "PASS: callback exception propagates; independent successor acquires lock",
                            "No platform calls; not a network-partition/fencing test"),
                    StandardCharsets.UTF_8);
        } finally {
            for (Process child : children)
                if (child.isAlive()) {
                    child.destroyForcibly();
                    assertTrue(child.waitFor(10, TimeUnit.SECONDS));
                }
            admin.execute("DROP SCHEMA " + schema + " CASCADE");
        }
    }

    @Test
    void twoWorkerInstancesSerializeTheSamePersistedTask() throws Exception {
        String url = System.getenv("DUOWEI_TEST_POSTGRES_URL");
        String user = System.getenv("DUOWEI_TEST_POSTGRES_USERNAME");
        String password = System.getenv("DUOWEI_TEST_POSTGRES_PASSWORD");
        JdbcTemplate admin = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
        String schema = "duowei_test_" + UUID.randomUUID().toString().replace("-", "");
        admin.execute("CREATE SCHEMA " + schema);
        List<BackgroundService> services = new ArrayList<>();
        try {
            JdbcTemplate db =
                    new JdbcTemplate(
                            new DriverManagerDataSource(
                                    url
                                            + (url.contains("?") ? "&" : "?")
                                            + "currentSchema="
                                            + schema,
                                    user,
                                    password));
            db.execute(
                    new String(
                            Files.readAllBytes(
                                    Paths.get("migrations/0002_duowei_automation_background.sql")),
                            StandardCharsets.UTF_8));
            JsonNode input = null;
            for (JsonNode item :
                    Protocol.JSON.readTree(
                            getClass().getResourceAsStream("/background-contracts.json")))
                if ("valid-new".equals(item.path("id").asText())) input = item;
            assertNotNull(input);
            String key = input.path("body").path("taskKey").asText();
            BackgroundJobRepository observer = new BackgroundJobRepository(db);
            observer.createOrRetry(key, input.path("body").toString());
            CountDownLatch rendering = new CountDownLatch(1);
            CountDownLatch releaseRender = new CountDownLatch(1);
            CountDownLatch rejected = new CountDownLatch(1);
            CountDownLatch completions = new CountDownLatch(1);
            java.util.concurrent.atomic.AtomicInteger uploads =
                    new java.util.concurrent.atomic.AtomicInteger();
            AutomationConfiguration config = mock(AutomationConfiguration.class);
            when(config.workerInterval()).thenReturn(60000L);
            when(config.signingSecret(anyString())).thenReturn(new byte[32]);
            FeishuClient api = mock(FeishuClient.class);
            // Use fixture field IDs; labels and field types remain platform substitutes.
            com.fasterxml.jackson.databind.node.ArrayNode fields = Protocol.JSON.createArrayNode();
            fields.addObject()
                    .put(
                            "field_id",
                            input.path("body").path("targets").path("attachmentFieldId").asText())
                    .put("field_name", "附件")
                    .put("type", 17);
            fields.addObject()
                    .put(
                            "field_id",
                            input.path("body").path("targets").path("statusFieldId").asText())
                    .put("field_name", "状态")
                    .put("type", 1);
            if (input.path("body").path("targets").has("errorFieldId"))
                fields.addObject()
                        .put(
                                "field_id",
                                input.path("body").path("targets").path("errorFieldId").asText())
                        .put("field_name", "错误")
                        .put("type", 1);
            ObjectNode metadata = Protocol.JSON.createObjectNode();
            metadata.putObject("data").set("items", fields);
            when(api.get(anyString(), anyString())).thenReturn(metadata);
            when(api.call(anyString(), any(), any(), anyString(), any()))
                    .thenAnswer(
                            call -> {
                                String endpoint = call.getArgument(0);
                                if (endpoint.contains("upload_all"))
                                    return Protocol.JSON.readTree(
                                            "{\"data\":{\"file_token\":\"isolated-upload-"
                                                    + uploads.incrementAndGet()
                                                    + "\"}}");
                                return Protocol.JSON.createObjectNode();
                            });
            RenderService renderer = mock(RenderService.class);
            when(renderer.render(any()))
                    .thenAnswer(
                            call -> {
                                rendering.countDown();
                                assertTrue(releaseRender.await(15, TimeUnit.SECONDS));
                                RenderService.Artifact artifact = new RenderService.Artifact();
                                artifact.bytes = new byte[] {1, 2};
                                artifact.fileName = "test.pdf";
                                artifact.contentType = "application/pdf";
                                return artifact;
                            });
            for (int i = 0; i < 2; i++) {
                BackgroundJobRepository jobs =
                        new BackgroundJobRepository(db) {
                            @Override
                            public boolean withWorkerLock(Runnable action) {
                                boolean acquired = super.withWorkerLock(action);
                                if (!acquired) rejected.countDown();
                                return acquired;
                            }

                            @Override
                            public void succeed(String id, String token) {
                                super.succeed(id, token);
                                completions.countDown();
                            }
                        };
                BackgroundService service = new BackgroundService(jobs, api, renderer, config);
                services.add(service);
                service.submit(
                        input.path("signature").asText(),
                        "isolated-token-long-enough",
                        (ObjectNode) input.path("body"));
                if (i == 0) assertTrue(rendering.await(15, TimeUnit.SECONDS));
            }
            assertTrue(rejected.await(15, TimeUnit.SECONDS), "Second consumer must be refused");
            releaseRender.countDown();
            assertTrue(completions.await(30, TimeUnit.SECONDS), "Owner must finish");
            assertEquals(1, uploads.get(), "Only lock owner may upload");
            assertEquals("succeeded", observer.status(key));
            String claimKey = key + "-claim";
            observer.createOrRetry(claimKey, input.path("body").toString());
            observer.processing(claimKey);
            ExecutorService claimers = Executors.newFixedThreadPool(2);
            try {
                CyclicBarrier claimBarrier = new CyclicBarrier(2);
                List<Future<Boolean>> claims = new ArrayList<>();
                for (int claimant = 0; claimant < 2; claimant++)
                    claims.add(
                            claimers.submit(
                                    () -> {
                                        claimBarrier.await(10, TimeUnit.SECONDS);
                                        return observer.beforeUpload(claimKey);
                                    }));
                int winners = 0;
                for (Future<Boolean> claim : claims) if (claim.get(15, TimeUnit.SECONDS)) winners++;
                assertEquals(
                        1, winners, "Exactly one stale consumer may acquire upload permission");
                observer.processing(claimKey);
                assertFalse(
                        observer.beforeUpload(claimKey),
                        "Stale processing must not erase review marker");
                observer.requireReview(claimKey, "uncertain");
                observer.createOrRetry(claimKey, input.path("body").toString());
                assertEquals("failed", observer.status(claimKey));
            } finally {
                claimers.shutdownNow();
                assertTrue(claimers.awaitTermination(10, TimeUnit.SECONDS));
                db.update(
                        "DELETE FROM duowei_automation_background_job WHERE task_key=?", claimKey);
            }

            assertEquals(
                    1,
                    db.queryForObject(
                            "SELECT attempt FROM duowei_automation_background_job", Integer.class));
            assertEquals(
                    1,
                    db.queryForObject(
                            "SELECT count(*) FROM duowei_automation_background_job",
                            Integer.class));
            Path directory =
                    Files.createDirectories(
                            Paths.get("target/concurrency", UUID.randomUUID().toString()));
            Files.write(
                    directory.resolve("multi-worker-risk.txt"),
                    Arrays.asList(
                            "R-03 MUTEX: two independent BackgroundService instances, shared real PostgreSQL",
                            "one task row; attempt=1; mocked uploads=1; final status=succeeded",
                            "Second consumer refused while first is rendering; no real platform calls",
                            "Not a separate-JVM test; no original-backend dynamic comparison"),
                    StandardCharsets.UTF_8);
        } finally {
            for (BackgroundService service : services) service.close();
            admin.execute("DROP SCHEMA " + schema + " CASCADE");
        }
    }

    @Test
    void duplicateBurstsMatchOriginalAndPreserveOneRowAndSuccessfulResult() throws Exception {
        String url = System.getenv("DUOWEI_TEST_POSTGRES_URL");
        String user = System.getenv("DUOWEI_TEST_POSTGRES_USERNAME"),
                password = System.getenv("DUOWEI_TEST_POSTGRES_PASSWORD");
        JdbcTemplate admin = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
        String schema = "duowei_test_" + UUID.randomUUID().toString().replace("-", "");
        admin.execute("CREATE SCHEMA " + schema);
        ExecutorService callers = Executors.newFixedThreadPool(8);
        try {
            JdbcTemplate db =
                    new JdbcTemplate(
                            new DriverManagerDataSource(
                                    url
                                            + (url.contains("?") ? "&" : "?")
                                            + "currentSchema="
                                            + schema,
                                    user,
                                    password));
            db.execute(
                    new String(
                            Files.readAllBytes(
                                    Paths.get("migrations/0002_duowei_automation_background.sql")),
                            StandardCharsets.UTF_8));
            JsonNode fixture = null;
            for (JsonNode item :
                    Protocol.JSON.readTree(
                            getClass().getResourceAsStream("/background-contracts.json")))
                if ("valid-new".equals(item.path("id").asText())) fixture = item;
            assertNotNull(fixture);
            final JsonNode input = fixture;
            String key = fixture.path("body").path("taskKey").asText();
            List<String> evidence = new ArrayList<>();
            for (JsonNode round :
                    Protocol.JSON.readTree(
                            getClass().getResourceAsStream("/background-concurrency.json"))) {
                db.update("DELETE FROM duowei_automation_background_job");
                CyclicBarrier barrier = new CyclicBarrier(8);
                BackgroundJobRepository jobs =
                        new BackgroundJobRepository(db) {
                            @Override
                            public boolean exists(String taskKey) {
                                boolean exists = super.exists(taskKey);
                                try {
                                    barrier.await(15, TimeUnit.SECONDS);
                                } catch (Exception error) {
                                    throw new IllegalStateException(error);
                                }
                                return exists;
                            }
                        };
                if (round.path("initialStatus").isTextual()) {
                    jobs.createOrRetry(key, input.path("body").toString());
                    if ("failed".equals(round.path("initialStatus").asText()))
                        jobs.fail(key, "failure");
                    else jobs.succeed(key, "original-file-token");
                }
                AutomationConfiguration config = mock(AutomationConfiguration.class);
                when(config.workerInterval()).thenReturn(60000L);
                when(config.signingSecret(anyString())).thenReturn(new byte[32]);
                FeishuClient feishu = mock(FeishuClient.class);
                RenderService renderer = mock(RenderService.class);
                BackgroundService service = new BackgroundService(jobs, feishu, renderer, config);
                service.close();
                List<Future<org.springframework.http.ResponseEntity<?>>> results =
                        new ArrayList<>();
                try {
                    for (int i = 0; i < 8; i++)
                        results.add(
                                callers.submit(
                                        () ->
                                                service.submit(
                                                        input.path("signature").asText(),
                                                        "isolated-token-long-enough",
                                                        (ObjectNode) input.path("body"))));
                    for (int i = 0; i < results.size(); i++) {
                        org.springframework.http.ResponseEntity<?> response =
                                results.get(i).get(30, TimeUnit.SECONDS);
                        ObjectNode actual = Protocol.JSON.valueToTree(response.getBody());
                        assertEquals(
                                actual.path("traceId").asText(),
                                response.getHeaders().getFirst("x-duowei-trace-id"));
                        actual.remove("traceId");
                        assertEquals(
                                round.path("expected").get(i).path("status").intValue(),
                                response.getStatusCodeValue());
                        assertEquals(round.path("expected").get(i).path("body"), actual);
                    }
                    assertEquals(
                            1,
                            db.queryForObject(
                                    "SELECT count(*) FROM duowei_automation_background_job",
                                    Integer.class));
                    assertEquals(round.path("finalStatus").asText(), jobs.status(key));
                    assertEquals(
                            0,
                            db.queryForObject(
                                    "SELECT attempt FROM duowei_automation_background_job",
                                    Integer.class));
                    if ("succeeded".equals(round.path("initialStatus").asText()))
                        assertEquals(
                                "original-file-token",
                                db.queryForObject(
                                        "SELECT file_token FROM duowei_automation_background_job",
                                        String.class));
                    verifyNoInteractions(feishu, renderer);
                    evidence.add(
                            "initial="
                                    + round.path("initialStatus")
                                    + ", requests=8, rows=1, status="
                                    + jobs.status(key)
                                    + ", responses match original");
                } finally {
                    service.close();
                }
            }
            Path directory =
                    Files.createDirectories(
                            Paths.get("target/concurrency", UUID.randomUUID().toString()));
            Files.write(directory.resolve("result.txt"), evidence, StandardCharsets.UTF_8);
        } finally {
            callers.shutdownNow();
            assertTrue(callers.awaitTermination(20, TimeUnit.SECONDS));
            admin.execute("DROP SCHEMA " + schema + " CASCADE");
        }
    }
}
