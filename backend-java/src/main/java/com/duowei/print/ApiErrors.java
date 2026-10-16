package com.duowei.print;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.*;
import java.util.*;
@RestControllerAdvice
public class ApiErrors {
 @ExceptionHandler(SecurityException.class)
 public ResponseEntity<?> auth(SecurityException e){return response(401,"AUTH_INVALID",e.getMessage());}
 @ExceptionHandler(IllegalArgumentException.class)
 public ResponseEntity<?> invalid(IllegalArgumentException e){return response(400,"REQUEST_INVALID",e.getMessage());}
 @ExceptionHandler(Exception.class)
 public ResponseEntity<?> internal(Exception e){return response(500,"INTERNAL_ERROR","服务请求失败，请联系管理员检查服务日志");}
 private ResponseEntity<?> response(int status,String code,String message){Map<String,Object> body=new LinkedHashMap<>();body.put("success",false);body.put("code",code);body.put("message",message);body.put("traceId",UUID.randomUUID().toString());return ResponseEntity.status(status).body(body);}
}
