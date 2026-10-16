package com.duowei.print.repository;

import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class BackgroundJobRepository {
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
                "INSERT INTO duowei_automation_background_job(job_id,task_key,status,attempt,submission) VALUES(?,?,'queued',0,?::jsonb) ON CONFLICT(task_key) DO UPDATE SET status=CASE WHEN duowei_automation_background_job.status='failed' THEN 'queued' ELSE duowei_automation_background_job.status END,error=CASE WHEN duowei_automation_background_job.status='failed' THEN NULL ELSE duowei_automation_background_job.error END,updated_at=CURRENT_TIMESTAMP",
                key,
                key,
                submission);
    }

    public String status(String key) {
        return db.queryForObject(
                "SELECT status FROM duowei_automation_background_job WHERE task_key=?",
                String.class,
                key);
    }

    public List<Map<String, Object>> recoverable() {
        return db.queryForList(
                "SELECT job_id,task_key,status,attempt,submission FROM duowei_automation_background_job WHERE status IN ('queued','processing') ORDER BY created_at");
    }

    public void processing(String key) {
        db.update(
                "UPDATE duowei_automation_background_job SET status='processing',attempt=attempt+1,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE job_id=?",
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
