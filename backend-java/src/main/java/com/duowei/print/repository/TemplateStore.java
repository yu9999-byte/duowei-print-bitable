package com.duowei.print.repository;

import com.duowei.print.security.Protocol;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class TemplateStore {
    private final JdbcTemplate db;

    public TemplateStore(JdbcTemplate db) {
        this.db = db;
    }

    public void upsert(JsonNode body) {
        JsonNode s = body.path("scope"), t = body.path("template");
        Protocol.safeSnapshot(t.path("snapshot"));
        if (!t.path("referencedFieldIds").isArray())
            throw new IllegalArgumentException("模板字段引用必须是数组");
        t.path("referencedFieldIds")
                .forEach(
                        field -> {
                            if (!field.isTextual()) throw new IllegalArgumentException("模板字段引用无效");
                        });
        db.update(
                "INSERT INTO duowei_automation_template(tenant_key,base_token,table_id,template_id,revision,name,status,snapshot,referenced_field_ids) VALUES(?,?,?,?,?,?,'ready',?::jsonb,?::jsonb) ON CONFLICT(tenant_key,base_token,table_id,template_id,revision) DO UPDATE SET name=excluded.name,status=excluded.status,snapshot=excluded.snapshot,referenced_field_ids=excluded.referenced_field_ids,updated_at=CURRENT_TIMESTAMP",
                Protocol.required(s, "tenantKey"),
                Protocol.required(s, "baseToken"),
                Protocol.required(s, "tableId"),
                Protocol.required(t, "id"),
                Protocol.required(t, "revision"),
                Protocol.required(t, "name"),
                t.path("snapshot").toString(),
                t.path("referencedFieldIds").toString());
    }

    public List<JsonNode> read(JsonNode body) {
        JsonNode s = body.path("scope");
        List<Object> args =
                new ArrayList<>(
                        Arrays.asList(
                                Protocol.required(s, "tenantKey"),
                                Protocol.required(s, "baseToken"),
                                Protocol.required(s, "tableId")));
        String sql =
                "SELECT * FROM duowei_automation_template WHERE tenant_key=? AND base_token=? AND table_id=?";
        if ("get".equals(body.path("operation").asText())) {
            sql += " AND template_id=? AND revision=?";
            args.add(Protocol.required(body.path("selection"), "id"));
            args.add(Protocol.required(body.path("selection"), "revision"));
        } else sql += " AND status='ready'";
        return db.query(
                sql + " ORDER BY updated_at DESC",
                (rs, n) -> {
                    ObjectNode t = Protocol.JSON.createObjectNode();
                    t.put("tenantKey", rs.getString("tenant_key"));
                    t.put("baseToken", rs.getString("base_token"));
                    t.put("tableId", rs.getString("table_id"));
                    t.put("id", rs.getString("template_id"));
                    t.put("revision", rs.getString("revision"));
                    t.put("name", rs.getString("name"));
                    t.put("status", rs.getString("status"));
                    try {
                        t.set("snapshot", Protocol.JSON.readTree(rs.getString("snapshot")));
                        t.set(
                                "referencedFieldIds",
                                Protocol.JSON.readTree(rs.getString("referenced_field_ids")));
                    } catch (Exception e) {
                        throw new java.sql.SQLException("模板数据无效", e);
                    }
                    if (!Arrays.asList("ready", "syncing", "error")
                            .contains(t.path("status").asText()))
                        throw new java.sql.SQLException("模板状态无效");
                    if (!t.path("referencedFieldIds").isArray())
                        throw new java.sql.SQLException("模板字段引用无效");
                    for (JsonNode field : t.path("referencedFieldIds"))
                        if (!field.isTextual()) throw new java.sql.SQLException("模板字段引用无效");
                    Protocol.safeSnapshot(t.path("snapshot"));
                    return (JsonNode) t;
                },
                args.toArray());
    }
}
