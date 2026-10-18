package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;

import com.duowei.print.repository.*;
import com.duowei.print.security.Protocol;
import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

/** Opt-in PostgreSQL test; never falls back to the application database configuration. */
@EnabledIfEnvironmentVariable(named = "DUOWEI_TEST_POSTGRES_URL", matches = "jdbc:postgresql:.+")
class PostgresIntegrationTest {
    @Test
    void migrationsAndRepositoriesRoundTripInIsolatedSchema() throws Exception {
        SingleConnectionDataSource source =
                new SingleConnectionDataSource(
                        System.getenv("DUOWEI_TEST_POSTGRES_URL"),
                        System.getenv("DUOWEI_TEST_POSTGRES_USERNAME"),
                        System.getenv("DUOWEI_TEST_POSTGRES_PASSWORD"),
                        true);
        JdbcTemplate db = new JdbcTemplate(source);
        String schema = "duowei_test_" + UUID.randomUUID().toString().replace("-", "");
        boolean created = false;
        try {
            db.execute("CREATE SCHEMA " + schema);
            created = true;
            db.execute("SET search_path TO " + schema);
            for (String file :
                    new String[] {
                        "0001_duowei_automation_template.sql",
                        "0002_duowei_automation_background.sql"
                    }) {
                String sql =
                        new String(
                                Files.readAllBytes(Paths.get("migrations", file)),
                                StandardCharsets.UTF_8);
                db.execute(sql);
            }
            TemplateStore templates = new TemplateStore(db);
            JsonNode body =
                    Protocol.JSON.readTree(
                            "{\"scope\":{\"tenantKey\":\"tenant\",\"baseToken\":\"base\",\"tableId\":\"table\"},\"template\":{\"id\":\"template\",\"revision\":\"r1\",\"name\":\"发货单\",\"snapshot\":{\"pages\":[]},\"referencedFieldIds\":[\"field\"]}}");
            templates.upsert(body);
            templates.upsert(body);
            JsonNode read =
                    Protocol.JSON.readTree(
                            "{\"operation\":\"list\",\"scope\":{\"tenantKey\":\"tenant\",\"baseToken\":\"base\",\"tableId\":\"table\"}}");
            assertEquals(1, templates.read(read).size());
            assertEquals("发货单", templates.read(read).get(0).path("name").asText());
            assertEquals(
                    "field",
                    templates.read(read).get(0).path("referencedFieldIds").get(0).asText());
            com.fasterxml.jackson.databind.node.ObjectNode otherRevision = body.deepCopy();
            ((com.fasterxml.jackson.databind.node.ObjectNode) otherRevision.path("template"))
                    .put("revision", "r2");
            templates.upsert(otherRevision);
            assertEquals(2, templates.read(read).size());
            db.update("UPDATE duowei_automation_template SET status='syncing' WHERE revision='r2'");
            assertEquals(1, templates.read(read).size());
            com.fasterxml.jackson.databind.node.ObjectNode get = read.deepCopy();
            get.put("operation", "get");
            get.putObject("selection").put("id", "template").put("revision", "r2");
            assertEquals("syncing", templates.read(get).get(0).path("status").asText());
            com.fasterxml.jackson.databind.node.ObjectNode otherScope = body.deepCopy();
            ((com.fasterxml.jackson.databind.node.ObjectNode) otherScope.path("scope"))
                    .put("tenantKey", "other-tenant");
            templates.upsert(otherScope);
            assertEquals(1, templates.read(read).size());
            ((com.fasterxml.jackson.databind.node.ObjectNode) get.path("selection"))
                    .put("revision", "missing");
            assertTrue(templates.read(get).isEmpty());
            BackgroundJobRepository jobs = new BackgroundJobRepository(db);
            jobs.createOrRetry("job", "{\"taskKey\":\"job\"}");
            assertTrue(jobs.exists("job"));
            assertEquals("queued", jobs.status("job"));
            jobs.processing("job");
            assertEquals(1, ((Number) jobs.recoverable().get(0).get("attempt")).intValue());
            jobs.fail("job", "test failure");
            assertTrue(jobs.recoverable().isEmpty());
            jobs.createOrRetry("job", "{\"taskKey\":\"changed\"}");
            assertEquals("queued", jobs.status("job"));
            assertEquals(
                    "job",
                    Protocol.JSON
                            .readTree(jobs.recoverable().get(0).get("submission").toString())
                            .path("taskKey")
                            .asText());
            assertNull(
                    db.queryForObject(
                            "SELECT error FROM duowei_automation_background_job WHERE job_id='job'",
                            String.class));
            jobs.processing("job");
            jobs.succeed("job", "file-token");
            java.sql.Timestamp succeededAt =
                    db.queryForObject(
                            "SELECT updated_at FROM duowei_automation_background_job WHERE job_id='job'",
                            java.sql.Timestamp.class);
            jobs.createOrRetry("job", "{}");
            assertEquals("succeeded", jobs.status("job"));
            assertEquals(
                    succeededAt,
                    db.queryForObject(
                            "SELECT updated_at FROM duowei_automation_background_job WHERE job_id='job'",
                            java.sql.Timestamp.class));
            assertTrue(jobs.recoverable().isEmpty());
            AppTicketRepository tickets = new AppTicketRepository(db);
            assertNull(tickets.get("cli_test"));
            tickets.save("cli_test", "ticket-one");
            tickets.save("cli_test", "ticket-two");
            assertEquals("ticket-two", tickets.get("cli_test"));

            jobs.createOrRetry(
                    "queued-after-reconnect", "{\"taskKey\":\"queued-after-reconnect\"}");
            jobs.createOrRetry(
                    "processing-after-reconnect", "{\"taskKey\":\"processing-after-reconnect\"}");
            jobs.processing("processing-after-reconnect");
            source.destroy();
            source =
                    new SingleConnectionDataSource(
                            System.getenv("DUOWEI_TEST_POSTGRES_URL"),
                            System.getenv("DUOWEI_TEST_POSTGRES_USERNAME"),
                            System.getenv("DUOWEI_TEST_POSTGRES_PASSWORD"),
                            true);
            db = new JdbcTemplate(source);
            db.execute("SET search_path TO " + schema);
            assertEquals("发货单", new TemplateStore(db).read(read).get(0).path("name").asText());
            assertEquals("ticket-two", new AppTicketRepository(db).get("cli_test"));
            BackgroundJobRepository reopenedJobs = new BackgroundJobRepository(db);
            assertEquals("succeeded", reopenedJobs.status("job"));
            assertEquals(
                    "file-token",
                    db.queryForObject(
                            "SELECT file_token FROM duowei_automation_background_job WHERE job_id='job'",
                            String.class));
            assertEquals(2, reopenedJobs.recoverable().size());
            java.util.Map<String, java.util.Map<String, Object>> recovered =
                    new java.util.HashMap<>();
            for (java.util.Map<String, Object> row : reopenedJobs.recoverable()) {
                recovered.put(row.get("task_key").toString(), row);
            }
            assertEquals("queued", recovered.get("queued-after-reconnect").get("status"));
            assertEquals(
                    0,
                    ((Number) recovered.get("queued-after-reconnect").get("attempt")).intValue());
            assertEquals("processing", recovered.get("processing-after-reconnect").get("status"));
            assertEquals(
                    1,
                    ((Number) recovered.get("processing-after-reconnect").get("attempt"))
                            .intValue());
            assertEquals(
                    "processing-after-reconnect",
                    Protocol.JSON
                            .readTree(
                                    recovered
                                            .get("processing-after-reconnect")
                                            .get("submission")
                                            .toString())
                            .path("taskKey")
                            .asText());
        } finally {
            try {
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
}
