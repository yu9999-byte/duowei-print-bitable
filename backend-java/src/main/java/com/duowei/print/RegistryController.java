package com.duowei.print;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.util.*;
@RestController
public class RegistryController {
 private final TemplateStore store;
 public RegistryController(TemplateStore store){this.store=store;}
 @GetMapping({"/api/automation/health","/openapi/duowei-print/health"})
 public Map<String,Object> health(){Map<String,Object> m=new LinkedHashMap<>();m.put("success",true);m.put("service","多维打印自动化服务");m.put("protocolVersion",1);return m;}
 @PostMapping(value={"/api/automation/registry","/openapi/duowei-print/registry-write","/openapi/duowei-print/registry-read"},consumes="application/json")
 public ResponseEntity<?> registry(javax.servlet.http.HttpServletRequest request,@RequestHeader(value="x-duowei-service-signature",defaultValue="") String signature,@RequestBody JsonNode body){
  boolean read=body.has("operation");String path=request.getRequestURI();
  if(path.endsWith("registry-write")&&read)return ResponseEntity.status(405).body(error("WRITE_ONLY_ENDPOINT"));
  if(path.endsWith("registry-read")&&!read)return ResponseEntity.status(405).body(error("READ_ONLY_ENDPOINT"));
  if(read){
   String op=body.path("operation").asText();if(!Arrays.asList("get","list").contains(op))throw new IllegalArgumentException("读取操作无效");
   Protocol.verify(signature,"duowei-registry-read-v1","duowei-template-registry-read",body,Protocol.secret("DUOWEI_REGISTRY_READ_SIGNING_SECRET_HEX"));
   List<JsonNode> rows=store.read(body);ObjectNode result=Protocol.JSON.createObjectNode();
   if("list".equals(op))result.set("templates",Protocol.JSON.valueToTree(rows));else result.set("template",rows.isEmpty()?NullNode.instance:rows.get(0));return ResponseEntity.ok(result);
  }
  JsonNode claims=Protocol.verify(signature,"duowei-registry-v1","duowei-template-registry-write",body,Protocol.secret("DUOWEI_REGISTRY_WRITE_SIGNING_SECRET_HEX"));
  if(!claims.path("canWrite").asBoolean())throw new SecurityException("没有写入权限");
  for(String key:Arrays.asList("tenantKey","baseToken","tableId"))if(!Protocol.required(body.path("scope"),key).equals(claims.path(key).asText()))throw new SecurityException("作用域不一致");
  store.upsert(body);return ResponseEntity.noContent().build();
 }
 private Map<String,Object> error(String code){Map<String,Object> m=new LinkedHashMap<>();m.put("success",false);m.put("code",code);return m;}
 @ExceptionHandler({SecurityException.class,IllegalArgumentException.class})
 public ResponseEntity<?> error(RuntimeException e){Map<String,Object> m=error(e instanceof SecurityException?"AUTH_INVALID":"REQUEST_INVALID");m.put("message",e.getMessage());m.put("traceId",UUID.randomUUID().toString());return ResponseEntity.status(e instanceof SecurityException?401:400).body(m);}
}
