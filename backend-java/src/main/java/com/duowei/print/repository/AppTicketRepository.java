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

    public String get(String appId) {
        java.util.List<String> tickets =
                db.query(
                        "SELECT ticket,received_at FROM duowei_automation_app_ticket WHERE app_id=? LIMIT 1",
                        (row, index) -> {
                            String ticket = row.getString("ticket");
                            if (ticket == null
                                    || ticket.trim().isEmpty()
                                    || row.getTimestamp("received_at") == null)
                                throw new IllegalStateException("app_ticket 持久化数据无效");
                            return ticket;
                        },
                        appId);
        return tickets.isEmpty() ? null : tickets.get(0);
    }
}
