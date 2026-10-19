package com.duowei.print.repository;

import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class BackgroundJobRepository {
    public static final String REVIEW_REQUIRED = "[REVIEW_REQUIRED]";

    public boolean beforeUpload(String key) {
        return db.update(
                        "UPDATE duowei_automation_background_job SET error=?,updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND status='processing' AND COALESCE(error,'') NOT LIKE '[REVIEW_REQUIRED]%'",
                        REVIEW_REQUIRED + " 上传结果待核对，禁止自动重试", key)
                == 1;
    }

    public void requireReview(String key, String message) {
        db.update(
                "UPDATE duowei_automation_background_job SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE job_id=?",
                REVIEW_REQUIRED + " " + message,
                key);
    }
    /** Session lock serializes consumers of this database/schema, including recovery scans. */
    public boolean withWorkerLock(Runnable action) {
        try (java.sql.Connection connection = db.getDataSource().getConnection()) {
            boolean acquired;
            try (java.sql.Statement statement = connection.createStatement();
                    java.sql.ResultSet result =
                            statement.executeQuery(
                                    "SELECT pg_try_advisory_lock(hashtext(current_database()), hashtext(current_schema() || ':duowei-background-worker'))")) {
                result.next();
                acquired = result.getBoolean(1);
            }
            if (!acquired) return false;
            try {
                action.run();
                return true;
            } finally {
                try (java.sql.Statement statement = connection.createStatement()) {
                    statement.execute(
                            "SELECT pg_advisory_unlock(hashtext(current_database()), hashtext(current_schema() || ':duowei-background-worker'))");
                } catch (java.sql.SQLException error) {
                    // Never return a potentially locked physical connection to the pool.
                    try {
                        connection.abort(Runnable::run);
                    } catch (java.sql.SQLException abortError) {
                        error.addSuppressed(abortError);
                    }
                    throw error;
                }
            }
        } catch (java.sql.SQLException error) {
            throw new IllegalStateException("后台任务消费锁失败", error);
        }
    }

    private final JdbcTemplate db;

    public BackgroundJobRepository(JdbcTemplate db) {
        this.db = db;
    }

    public boolean exists(String key) {
        return !db.queryForList(
                        "SELECT job_id FROM duowei_automation_background_job WHERE task_key=?", key)
                .isEmpty();
    }

    public void createOrRetry(String key, String submission) {
        db.update(
                "INSERT INTO duowei_automation_background_job(job_id,task_key,status,attempt,submission) VALUES(?,?,'queued',0,?::jsonb) ON CONFLICT(task_key) DO UPDATE SET status='queued',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE duowei_automation_background_job.status='failed' AND COALESCE(duowei_automation_background_job.error,'') NOT LIKE '[REVIEW_REQUIRED]%'",
                key, key, submission);
    }

    public String status(String key) {
        return db.queryForObject(
                "SELECT status FROM duowei_automation_background_job WHERE task_key=?",
                String.class,
                key);
    }

    public List<Map<String, Object>> recoverable() {
        return db.queryForList(
                "SELECT job_id,task_key,status,attempt,submission FROM duowei_automation_background_job WHERE status IN ('queued','processing') AND COALESCE(error,'') NOT LIKE '[REVIEW_REQUIRED]%' ORDER BY created_at");
    }

    public void processing(String key) {
        db.update(
                "UPDATE duowei_automation_background_job SET status='processing',attempt=attempt+1,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND status IN ('queued','processing') AND COALESCE(error,'') NOT LIKE '[REVIEW_REQUIRED]%'",
                key);
    }

    public void succeed(String key, String token) {
        db.update(
                "UPDATE duowei_automation_background_job SET status='succeeded',file_token=?,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE job_id=?",
                token,
                key);
    }

    public void fail(String key, String message) {
        db.update(
                "UPDATE duowei_automation_background_job SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE job_id=?",
                message,
                key);
    }
}
