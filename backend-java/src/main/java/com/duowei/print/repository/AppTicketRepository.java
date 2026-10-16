package com.duowei.print.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class AppTicketRepository {
    private final JdbcTemplate db;

    public AppTicketRepository(JdbcTemplate db) {
        this.db = db;
    }

    public void save(String appId, String ticket) {
        db.update(
                "INSERT INTO duowei_automation_app_ticket(app_id,ticket,received_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(app_id) DO UPDATE SET ticket=excluded.ticket,received_at=excluded.received_at,updated_at=CURRENT_TIMESTAMP",
                appId,
                ticket);
    }
}
