package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.duowei.print.repository.TemplateStore;
import com.duowei.print.security.Protocol;
import com.fasterxml.jackson.databind.JsonNode;
import java.sql.ResultSet;
import java.util.Collections;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class TemplateRowTest {
    @Test
    void preservesScopeRevisionSnapshotAndRejectsInvalidFields() throws Exception {
        JdbcTemplate db = mock(JdbcTemplate.class);
        ResultSet row = mock(ResultSet.class);
        String[][] columns = {
            {"tenant_key", "tenant"},
            {"base_token", "base"},
            {"table_id", "table"},
            {"template_id", "template"},
            {"revision", "revision"},
            {"name", "发货单"},
            {"status", "ready"},
            {"snapshot", "{\"pages\":[]}"},
            {"referenced_field_ids", "[\"field-a\"]"}
        };
        for (String[] column : columns) when(row.getString(column[0])).thenReturn(column[1]);
        when(db.query(
                        anyString(),
                        org.mockito.ArgumentMatchers.<RowMapper<JsonNode>>any(),
                        eq("tenant"),
                        eq("base"),
                        eq("table")))
                .thenAnswer(
                        invocation -> {
                            RowMapper<JsonNode> mapper = invocation.getArgument(1);
                            return Collections.singletonList(mapper.mapRow(row, 0));
                        });
        JsonNode request =
                Protocol.JSON.readTree(
                        "{\"operation\":\"list\",\"scope\":{\"tenantKey\":\"tenant\",\"baseToken\":\"base\",\"tableId\":\"table\"}}");
        TemplateStore store = new TemplateStore(db);
        JsonNode template = store.read(request).get(0);
        assertEquals("tenant", template.path("tenantKey").asText());
        assertEquals("base", template.path("baseToken").asText());
        assertEquals("table", template.path("tableId").asText());
        assertEquals("template", template.path("id").asText());
        assertEquals("revision", template.path("revision").asText());
        assertEquals("发货单", template.path("name").asText());
        assertEquals(Protocol.JSON.readTree("{\"pages\":[]}"), template.path("snapshot"));
        assertEquals("field-a", template.path("referencedFieldIds").get(0).asText());
        when(row.getString("referenced_field_ids")).thenReturn("[42]");
        assertThrows(java.sql.SQLException.class, () -> store.read(request));
    }
}
