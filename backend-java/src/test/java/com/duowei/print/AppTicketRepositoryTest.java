package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.duowei.print.repository.AppTicketRepository;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.util.Collections;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class AppTicketRepositoryTest {
    @Test
    void readsTicketAndRejectsCorruptPersistedRows() throws Exception {
        JdbcTemplate db = mock(JdbcTemplate.class);
        ResultSet row = mock(ResultSet.class);
        when(row.getString("ticket")).thenReturn("ticket");
        when(row.getTimestamp("received_at")).thenReturn(new Timestamp(1000));
        when(db.query(
                        anyString(),
                        org.mockito.ArgumentMatchers.<RowMapper<String>>any(),
                        eq("app")))
                .thenAnswer(
                        invocation -> {
                            RowMapper<String> mapper = invocation.getArgument(1);
                            return Collections.singletonList(mapper.mapRow(row, 0));
                        });
        AppTicketRepository repository = new AppTicketRepository(db);
        assertEquals("ticket", repository.get("app"));
        when(row.getString("ticket")).thenReturn(" ");
        assertThrows(IllegalStateException.class, () -> repository.get("app"));
        when(row.getString("ticket")).thenReturn("ticket");
        when(row.getTimestamp("received_at")).thenReturn(null);
        assertThrows(IllegalStateException.class, () -> repository.get("app"));
    }

    @Test
    void absentTicketReturnsNull() {
        JdbcTemplate db = mock(JdbcTemplate.class);
        when(db.query(
                        anyString(),
                        org.mockito.ArgumentMatchers.<RowMapper<String>>any(),
                        eq("app")))
                .thenReturn(Collections.emptyList());
        assertNull(new AppTicketRepository(db).get("app"));
    }
}
