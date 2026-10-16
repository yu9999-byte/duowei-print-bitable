package com.duowei.print.exception;

import java.util.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestControllerAdvice
public class ApiErrors {
    @ExceptionHandler(SecurityException.class)
    public ResponseEntity<?> auth(SecurityException e) {
        return response(401, "AUTH_INVALID", e.getMessage());
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<?> invalid(IllegalArgumentException e) {
        return response(400, "REQUEST_INVALID", e.getMessage());
    }

    @ExceptionHandler(org.springframework.http.converter.HttpMessageNotReadableException.class)
    public ResponseEntity<?> malformedJson(Exception e) {
        return response(400, "JSON_INVALID", "请求不是有效 JSON");
    }

    @ExceptionHandler(org.springframework.web.HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<?> unsupportedMethod(Exception e) {
        return response(405, "METHOD_NOT_ALLOWED", "请求方法不受支持");
    }

    @ExceptionHandler(org.springframework.web.HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<?> unsupportedMedia(Exception e) {
        return response(415, "CONTENT_TYPE_INVALID", "请求必须使用 JSON");
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<?> internal(Exception e) {
        return response(500, "INTERNAL_ERROR", "服务请求失败，请联系管理员检查服务日志");
    }

    private ResponseEntity<?> response(int status, String code, String message) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("success", false);
        body.put("code", code);
        body.put("message", SafeMessages.sanitize(message));
        String trace = UUID.randomUUID().toString();
        body.put("traceId", trace);
        return ResponseEntity.status(status).header("x-duowei-trace-id", trace).body(body);
    }
}
