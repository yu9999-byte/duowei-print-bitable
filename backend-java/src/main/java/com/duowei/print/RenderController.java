package com.duowei.print;
import com.fasterxml.jackson.databind.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.*;
import org.springframework.core.io.ClassPathResource;
@RestController
public class RenderController {
 private final RenderService renderer;
 public RenderController(RenderService renderer){this.renderer=renderer;}
 @PostMapping({"/api/automation/render","/openapi/duowei-print/render"})
 public ResponseEntity<byte[]> render(@RequestHeader("x-duowei-service-signature") String signature,@RequestBody JsonNode body){
  JsonNode claims=Protocol.verify(signature,"duowei-renderer-v1","duowei-renderer",body,Protocol.secret("DUOWEI_RENDERER_SIGNING_SECRET_HEX"));
  if(!Protocol.required(body,"artifactKey").equals(claims.path("artifactKey").asText()))throw new SecurityException("产物键不一致");
  RenderService.Artifact a=renderer.render(body);return ResponseEntity.ok().contentType(MediaType.parseMediaType(a.contentType)).header("x-duowei-artifact-key",a.artifactKey).header("x-duowei-file-name",FeishuClient.enc(a.fileName)).header("x-duowei-page-count",String.valueOf(a.pageCount)).body(a.bytes);
 }
 @GetMapping(value="/openapi/duowei-print/renderer",produces="text/html;charset=UTF-8")
 public org.springframework.core.io.Resource page(){return new ClassPathResource("renderer.html");}
}
