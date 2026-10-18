package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.duowei.print.config.AutomationConfiguration;
import com.duowei.print.integration.feishu.FeishuClient;
import com.duowei.print.repository.BackgroundJobRepository;
import com.duowei.print.security.Protocol;
import com.duowei.print.service.job.BackgroundService;
import com.duowei.print.service.render.RenderService;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

/**
 * Real JVM crash and PostgreSQL recovery; Feishu and rendering ports are controlled test doubles.
 */
@EnabledIfEnvironmentVariable(named = "DUOWEI_TEST_POSTGRES_URL", matches = "jdbc:postgresql:.+")
public class PostgresProcessRecoveryTest {
    private static final String KEY =
            "duowei-job:v1:" + String.join("", Collections.nCopies(64, "c"));

    private static SingleConnectionDataSource connect() {
        return new SingleConnectionDataSource(
                System.getenv("DUOWEI_TEST_POSTGRES_URL"),
                System.getenv("DUOWEI_TEST_POSTGRES_USERNAME"),
                System.getenv("DUOWEI_TEST_POSTGRES_PASSWORD"),
                true);
    }

    private static ObjectNode submission() throws Exception {
        return (ObjectNode)
                Protocol.JSON.readTree(
                        "{\"version\":1,\"taskKey\":\""
                                + KEY
                                + "\",\"tenantKey\":\"tenant\",\"baseToken\":\"base\",\"tableId\":\"table\",\"recordId\":\"record\",\"outputType\":\"pdf\",\"renderRequest\":{\"artifactKey\":\"duowei:v1:restart\",\"output\":{\"type\":\"pdf\"}},\"targets\":{\"attachmentFieldId\":\"a\",\"statusFieldId\":\"s\"}}");
    }

    private static void awaitFile(Path file, Process process) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
        while (!Files.exists(file) && process.isAlive() && System.nanoTime() < deadline)
            Thread.sleep(50);
        assertTrue(Files.exists(file), "Missing child checkpoint: " + file);
    }

    private static Process launch(String schema, Path evidence, String mode) throws Exception {
        String java = Paths.get(System.getProperty("java.home"), "bin", "java.exe").toString();
        if (!Files.exists(Paths.get(java)))
            java = Paths.get(System.getProperty("java.home"), "bin", "java").toString();
        return new ProcessBuilder(
                        java,
                        "-cp",
                        System.getProperty(
                                "surefire.test.class.path", System.getProperty("java.class.path")),
                        Worker.class.getName(),
                        schema,
                        evidence.toAbsolutePath().toString(),
                        mode)
                .redirectErrorStream(true)
                .redirectOutput(evidence.resolve(mode + ".log").toFile())
                .start();
    }

    private static void stop(Process process) throws Exception {
        if (process != null && process.isAlive()) {
            process.destroyForcibly();
            assertTrue(process.waitFor(10, TimeUnit.SECONDS), "Test JVM did not stop");
        }
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"render", "uploaded", "written"})
    void killedWorkerWaitsForNewCredentialThenResumesPersistedProcessingJob(String window)
            throws Exception {
        String schema = "duowei_test_" + UUID.randomUUID().toString().replace("-", "");
        Path evidence = Files.createDirectories(Paths.get("target", "process-recovery", schema));
        SingleConnectionDataSource source = connect();
        JdbcTemplate db = new JdbcTemplate(source);
        Process first = null, second = null;
        boolean created = false;
        try {
            Files.write(evidence.resolve("crash-window"), window.getBytes(StandardCharsets.UTF_8));
            db.execute("CREATE SCHEMA " + schema);
            created = true;
            db.execute("SET search_path TO " + schema);
            for (String migration :
                    Arrays.asList(
                            "0001_duowei_automation_template.sql",
                            "0002_duowei_automation_background.sql"))
                db.execute(
                        new String(
                                Files.readAllBytes(Paths.get("migrations", migration)),
                                StandardCharsets.UTF_8));
            first = launch(schema, evidence, "crash");
            awaitFile(evidence.resolve("crash-checkpoint"), first);
            BackgroundJobRepository jobs = new BackgroundJobRepository(db);
            assertEquals("processing", jobs.status(KEY));
            assertEquals(1, ((Number) jobs.recoverable().get(0).get("attempt")).intValue());
            stop(first);
            second = launch(schema, evidence, "resume");
            awaitFile(evidence.resolve("ready-resume"), second);
            Thread.sleep(1000);
            assertEquals("processing", jobs.status(KEY));
            assertEquals(1, ((Number) jobs.recoverable().get(0).get("attempt")).intValue());
            assertFalse(
                    Files.exists(evidence.resolve("render-resume")),
                    "Must not render without fresh credentials");
            assertFalse(
                    Files.exists(evidence.resolve("api-resume")),
                    "Must not call Feishu without fresh credentials");
            Files.write(evidence.resolve("provide-credential"), new byte[] {1});
            assertTrue(second.waitFor(30, TimeUnit.SECONDS), "Recovery JVM did not complete");
            assertEquals(0, second.exitValue(), "See resume.log");
            assertEquals("succeeded", jobs.status(KEY));
            assertEquals(
                    2,
                    db.queryForObject(
                            "SELECT attempt FROM duowei_automation_background_job WHERE task_key=?",
                            Integer.class,
                            KEY));
            assertEquals(
                    "recovered-file",
                    db.queryForObject(
                            "SELECT file_token FROM duowei_automation_background_job WHERE task_key=?",
                            String.class,
                            KEY));
            assertEquals(
                    "render".equals(window) ? 1 : 2,
                    Files.readAllLines(evidence.resolve("uploads"), StandardCharsets.UTF_8).size(),
                    "Post-upload crash currently repeats upload; this test characterizes the risk");
            assertEquals(
                    "written".equals(window)
                            ? Arrays.asList("等待生成", "生成中", "生成成功")
                            : Arrays.asList("等待生成", "生成中"),
                    Files.readAllLines(evidence.resolve("statuses-crash"), StandardCharsets.UTF_8));
            assertEquals(
                    Arrays.asList("生成中", "生成成功"),
                    Files.readAllLines(
                            evidence.resolve("statuses-resume"), StandardCharsets.UTF_8));
            assertTrue(jobs.recoverable().isEmpty());
            assertEquals(
                    1,
                    db.queryForObject(
                            "SELECT count(*) FROM duowei_automation_background_job",
                            Integer.class));
        } finally {
            try {
                stop(first);
                stop(second);
                if (created) {
                    db.execute("ROLLBACK");
                    db.execute("SET search_path TO public");
                    db.execute("DROP SCHEMA " + schema + " CASCADE");
                }
            } finally {
                source.destroy();
            }
        }
    }

    public static class Worker {
        private static void checkpoint(Path evidence, String mode, String window) throws Exception {
            if ("crash".equals(mode)
                    && window.equals(
                            new String(
                                    Files.readAllBytes(evidence.resolve("crash-window")),
                                    StandardCharsets.UTF_8))) {
                Files.write(evidence.resolve("crash-checkpoint"), new byte[] {1});
                new java.util.concurrent.CountDownLatch(1).await();
            }
        }

        public static void main(String[] args) throws Exception {
            Path evidence = Paths.get(args[1]);
            String mode = args[2];
            SingleConnectionDataSource source = connect();
            JdbcTemplate db = new JdbcTemplate(source);
            db.execute("SET search_path TO " + args[0]);
            BackgroundJobRepository jobs = new BackgroundJobRepository(db);
            AutomationConfiguration configuration = mock(AutomationConfiguration.class);
            when(configuration.workerInterval()).thenReturn(250L);
            when(configuration.signingSecret(anyString())).thenReturn(new byte[32]);
            FeishuClient api = mock(FeishuClient.class);
            when(api.get(anyString(), anyString()))
                    .thenAnswer(
                            call -> {
                                Files.write(evidence.resolve("api-" + mode), new byte[] {1});
                                return Protocol.JSON.readTree(
                                        "{\"data\":{\"items\":[{\"field_id\":\"a\",\"field_name\":\"附件\",\"type\":17},{\"field_id\":\"s\",\"field_name\":\"状态\",\"type\":1}],\"has_more\":false}}");
                            });
            when(api.call(anyString(), any(), any(), anyString(), any()))
                    .thenAnswer(
                            call -> {
                                if (((String) call.getArgument(0)).contains("upload_all")) {
                                    Files.write(
                                            evidence.resolve("uploads"),
                                            Collections.singletonList("upload"),
                                            StandardCharsets.UTF_8,
                                            StandardOpenOption.CREATE,
                                            StandardOpenOption.APPEND);
                                    checkpoint(evidence, mode, "uploaded");
                                    return Protocol.JSON.readTree(
                                            "{\"data\":{\"file_token\":\"recovered-file\"}}");
                                }
                                com.fasterxml.jackson.databind.JsonNode update =
                                        call.getArgument(2);
                                Files.write(
                                        evidence.resolve("statuses-" + mode),
                                        Collections.singletonList(
                                                update.path("fields").path("状态").asText()),
                                        StandardCharsets.UTF_8,
                                        StandardOpenOption.CREATE,
                                        StandardOpenOption.APPEND);
                                if ("生成成功".equals(update.path("fields").path("状态").asText())) {
                                    checkpoint(evidence, mode, "written");
                                }
                                return Protocol.JSON.createObjectNode();
                            });
            RenderService renderer = mock(RenderService.class);
            when(renderer.render(any()))
                    .thenAnswer(
                            call -> {
                                Files.write(evidence.resolve("render-" + mode), new byte[] {1});
                                checkpoint(evidence, mode, "render");
                                RenderService.Artifact artifact = new RenderService.Artifact();
                                artifact.bytes = "%PDF-test".getBytes(StandardCharsets.US_ASCII);
                                artifact.fileName = "test.pdf";
                                artifact.contentType = "application/pdf";
                                artifact.pageCount = 1;
                                return artifact;
                            });
            BackgroundService service = new BackgroundService(jobs, api, renderer, configuration);
            try {
                service.start();
                Files.write(evidence.resolve("ready-" + mode), new byte[] {1});
                if ("resume".equals(mode)) {
                    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
                    while (!Files.exists(evidence.resolve("provide-credential"))) {
                        if (System.nanoTime() > deadline)
                            throw new IllegalStateException("Credential checkpoint timeout");
                        Thread.sleep(50);
                    }
                }
                ObjectNode body = submission();
                ObjectNode claims = Protocol.JSON.createObjectNode();
                claims.put("version", 1)
                        .put("audience", "duowei-background-job")
                        .put("issuedAt", System.currentTimeMillis())
                        .put("expiresAt", System.currentTimeMillis() + 300000)
                        .put("taskKey", KEY)
                        .put("bodyDigest", Protocol.digest(Protocol.canonical(body)));
                service.submit(
                        Protocol.sign("duowei-background-job-v1", claims, new byte[32]),
                        "test-ephemeral-token-long-enough",
                        body);
                long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
                while (!"succeeded".equals(jobs.status(KEY))) {
                    if (System.nanoTime() > deadline)
                        throw new IllegalStateException("Job completion timeout");
                    Thread.sleep(50);
                }
            } finally {
                service.close();
                source.destroy();
            }
        }
    }
}
