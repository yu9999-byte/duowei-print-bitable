package com.duowei.print;
import com.fasterxml.jackson.databind.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.util.*;
@RestController
public class EventController {
 private final JdbcTemplate db;
 public EventController(JdbcTemplate db){this.db=db;}
 @PostMapping("/openapi/duowei-print/events")
 public ResponseEntity<?> event(@RequestBody JsonNode body){
  if(body.has("encrypt"))return ResponseEntity.badRequest().body(Collections.singletonMap("code","ENCRYPTED_EVENT_NOT_CONFIGURED"));
  if(!MessageDigest.isEqual(body.path("token").asText().getBytes(StandardCharsets.UTF_8),FeishuClient.env("DUOWEI_EVENT_VERIFICATION_TOKEN").getBytes(StandardCharsets.UTF_8)))return ResponseEntity.status(401).body(Collections.singletonMap("code","VERIFICATION_FAILED"));
  if("url_verification".equals(body.path("type").asText()))return ResponseEntity.ok(Collections.singletonMap("challenge",Protocol.required(body,"challenge")));
  JsonNode event=body.path("event");if("app_ticket".equals(event.path("type").asText())){
   if(!FeishuClient.env("DUOWEI_FEISHU_APP_ID").equals(event.path("app_id").asText()))throw new IllegalArgumentException("APP_TICKET_INVALID");
   db.update("INSERT INTO duowei_automation_app_ticket(app_id,ticket,received_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(app_id) DO UPDATE SET ticket=excluded.ticket,received_at=excluded.received_at,updated_at=CURRENT_TIMESTAMP",event.path("app_id").asText(),Protocol.required(event,"app_ticket"));
  }return ResponseEntity.ok(Collections.singletonMap("code",0));
 }
}
