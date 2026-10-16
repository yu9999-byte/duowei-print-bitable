package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.duowei.print.repository.BackgroundJobRepository;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;

class BackgroundRepositoryTest {
    @Test
    void retryPreservesSubmissionAndClearsFailureOnlyForFailedJobs() {
        JdbcTemplate db = mock(JdbcTemplate.class);
        BackgroundJobRepository jobs = new BackgroundJobRepository(db);
        jobs.createOrRetry("job", "{\"taskKey\":\"job\"}");
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(db).update(sql.capture(), eq("job"), eq("job"), eq("{\"taskKey\":\"job\"}"));
        String update = sql.getValue().split("DO UPDATE SET")[1];
        assertTrue(update.contains("status='failed'"));
        assertTrue(update.contains("THEN NULL"));
        assertFalse(update.contains("submission="));
    }

    @Test
    void recoveryIncludesQueuedAndProcessingJobsInCreationOrder() {
        JdbcTemplate db = mock(JdbcTemplate.class);
        BackgroundJobRepository jobs = new BackgroundJobRepository(db);
        when(db.queryForList(anyString())).thenReturn(Collections.emptyList());
        assertTrue(jobs.recoverable().isEmpty());
        verify(db)
                .queryForList(
                        "SELECT job_id,task_key,status,attempt,submission FROM duowei_automation_background_job WHERE status IN ('queued','processing') ORDER BY created_at");
    }
}
