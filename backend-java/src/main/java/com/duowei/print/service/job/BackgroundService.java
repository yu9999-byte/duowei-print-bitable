package com.duowei.print.service.job;

import com.duowei.print.integration.feishu.FeishuClient;
import com.duowei.print.security.Protocol;
import com.duowei.print.service.render.RenderService;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;
import java.util.concurrent.*;
import javax.annotation.PreDestroy;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.*;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.bind.annotation.*;

@org.springframework.stereotype.Service
public class BackgroundService {
    private final com.duowei.print.repository.BackgroundJobRepository jobs;
    private final FeishuClient api;
    private final RenderService renderer;
    private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor();
    private final long workerInterval;
    private final com.duowei.print.config.AutomationConfiguration configuration;

    @javax.annotation.PostConstruct
    public void start() {
        worker.scheduleWithFixedDelay(
                this::drain, workerInterval, workerInterval, TimeUnit.MILLISECONDS);
    }

    private final Map<String, String> tokens = new ConcurrentHashMap<>();
    private final Map<String, Long> expires = new ConcurrentHashMap<>();

    public BackgroundService(
            com.duowei.print.repository.BackgroundJobRepository jobs,
            FeishuClient api,
            RenderService renderer,
            com.duowei.print.config.AutomationConfiguration configuration) {
        this.configuration = configuration;
        this.jobs = jobs;
        this.api = api;
        this.renderer = renderer;
        this.workerInterval = configuration.workerInterval();
    }

    @PreDestroy
    public void close() {
        worker.shutdownNow();
    }

    public ResponseEntity<?> submit(String signature, String token, ObjectNode body) {
        if (token.trim().length() < 20) throw new IllegalArgumentException("后台任务缺少临时租户凭证");
        body = body.deepCopy();
        String key = Protocol.required(body, "taskKey");
        body.put("taskKey", key);
        if (!key.matches("duowei-job:v1:[0-9a-f]{64}") || body.path("version").asInt() != 1)
            throw new IllegalArgumentException("后台任务键或版本无效");
        for (String f :
                Arrays.asList("tenantKey", "baseToken", "tableId", "recordId", "outputType"))
            body.put(f, Protocol.required(body, f));
        if (!Arrays.asList("pdf", "png").contains(body.path("outputType").asText())
                || !body.path("outputType")
                        .equals(body.path("renderRequest").path("output").path("type"))
                || !body.path("renderRequest")
                        .path("artifactKey")
                        .asText()
                        .startsWith("duowei:v1:")) throw new IllegalArgumentException("后台任务渲染请求无效");
        JsonNode targets = body.path("targets");
        String attachment = Protocol.required(targets, "attachmentFieldId"),
                status = Protocol.required(targets, "statusFieldId"),
                error = targets.path("errorFieldId").asText("").trim();
        if (attachment.equals(status)
                || !error.isEmpty() && (error.equals(attachment) || error.equals(status)))
            throw new IllegalArgumentException("后台任务字段不能重复");
        ObjectNode normalizedTargets = Protocol.JSON.createObjectNode();
        normalizedTargets.put("attachmentFieldId", attachment);
        normalizedTargets.put("statusFieldId", status);
        body.set("targets", normalizedTargets);
        targets = normalizedTargets;
        if (!error.isEmpty()) ((ObjectNode) targets).put("errorFieldId", error);
        else ((ObjectNode) targets).remove("errorFieldId");
        Set<String> allowed =
                new HashSet<>(
                        Arrays.asList(
                                "version",
                                "taskKey",
                                "tenantKey",
                                "baseToken",
                                "tableId",
                                "recordId",
                                "outputType",
                                "renderRequest",
                                "targets"));
        Iterator<String> names = body.fieldNames();
        while (names.hasNext()) {
            if (!allowed.contains(names.next())) throw new IllegalArgumentException("任务包含不支持的属性");
        }
        JsonNode claims =
                Protocol.verify(
                        signature,
                        "duowei-background-job-v1",
                        "duowei-background-job",
                        body,
                        configuration.signingSecret("DUOWEI_BACKGROUND_JOB_SIGNING_SECRET_HEX"));
        if (!key.equals(claims.path("taskKey").asText())) throw new SecurityException("任务键签名不一致");
        boolean existing = jobs.exists(key);
        jobs.createOrRetry(key, body.toString());
        String tenant = body.path("tenantKey").asText();
        tokens.put(tenant, token.trim());
        expires.put(tenant, System.currentTimeMillis() + 5400000);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("jobId", key);
        result.put("status", jobs.status(key));
        result.put("reused", existing);
        String trace = UUID.randomUUID().toString();
        result.put("traceId", trace);
        return ResponseEntity.status(existing ? 200 : 202)
                .header("x-duowei-trace-id", trace)
                .body(result);
    }

    private void drain() {
        try {
            List<Map<String, Object>> recoverable = jobs.recoverable();
            for (Map<String, Object> row : recoverable) {
                JsonNode body = Protocol.JSON.readTree(row.get("submission").toString());
                String jobId = String.valueOf(row.get("job_id"));
                String taskKey = body.path("taskKey").asText();
                int attempt =
                        row.get("attempt") == null
                                ? 0
                                : Integer.parseInt(String.valueOf(row.get("attempt")));
                String status = row.get("status") == null ? "" : String.valueOf(row.get("status"));
                if (!jobId.equals(taskKey)
                        || !jobId.equals(row.get("task_key"))
                        || attempt < 0
                        || !Arrays.asList("queued", "processing").contains(status))
                    throw new IllegalStateException("后台任务持久化行无效");
                String tenant = body.path("tenantKey").asText();
                if (expires.getOrDefault(tenant, 0L) > System.currentTimeMillis())
                    process(jobId, body, tokens.get(tenant));
            }
        } catch (Exception e) {
            System.err.println("后台任务扫描失败：" + e.getClass().getSimpleName());
        }
    }

    private String recordUrl(JsonNode b) {
        return "https://open.feishu.cn/open-apis/bitable/v1/apps/"
                + FeishuClient.enc(b.path("baseToken").asText())
                + "/tables/"
                + FeishuClient.enc(b.path("tableId").asText())
                + "/records/"
                + FeishuClient.enc(b.path("recordId").asText());
    }

    private void update(JsonNode b, String token, ObjectNode fields) {
        ObjectNode root = Protocol.JSON.createObjectNode();
        root.set("fields", fields);
        api.call(recordUrl(b), HttpMethod.PUT, root, token, MediaType.APPLICATION_JSON);
    }

    private void process(String id, JsonNode b, String token) {
        String statusName = null, errorName = null;
        try {
            Map<String, JsonNode> fields = new HashMap<>();
            String page = "";
            do {
                JsonNode data =
                        api.get(
                                        "https://open.feishu.cn/open-apis/bitable/v1/apps/"
                                                + FeishuClient.enc(b.path("baseToken").asText())
                                                + "/tables/"
                                                + FeishuClient.enc(b.path("tableId").asText())
                                                + "/fields?page_size=100"
                                                + (page.isEmpty()
                                                        ? ""
                                                        : "&page_token=" + FeishuClient.enc(page)),
                                        token)
                                .path("data");
                data.path("items").forEach(f -> fields.put(f.path("field_id").asText(), f));
                page =
                        data.path("has_more").asBoolean()
                                ? Protocol.required(data, "page_token")
                                : "";
            } while (!page.isEmpty());
            JsonNode targets = b.path("targets"),
                    attachment = fields.get(targets.path("attachmentFieldId").asText()),
                    status = fields.get(targets.path("statusFieldId").asText()),
                    error = fields.get(targets.path("errorFieldId").asText());
            if (attachment == null
                    || attachment.path("type").asInt() != 17
                    || status == null
                    || status.path("type").asInt() != 1
                    || targets.has("errorFieldId")
                            && (error == null || error.path("type").asInt() != 1))
                throw new IllegalArgumentException("选择的字段不存在或类型已变化");
            statusName = Protocol.required(status, "field_name");
            errorName = error == null ? null : Protocol.required(error, "field_name");
            ObjectNode values = Protocol.JSON.createObjectNode();
            values.put(statusName, "等待生成");
            if (errorName != null) values.put(errorName, "");
            if ("queued".equals(jobs.status(id))) update(b, token, values);
            values.put(statusName, "生成中");
            if (errorName != null) values.put(errorName, "");
            jobs.processing(id);
            update(b, token, values);
            final RenderService.Artifact a = renderer.render(b.path("renderRequest"));
            if (a.bytes.length > 20 * 1024 * 1024) throw new IllegalArgumentException("文件超过20MB限制");
            LinkedMultiValueMap<String, Object> form = new LinkedMultiValueMap<>();
            form.add("file_name", a.fileName);
            form.add("parent_type", "bitable_file");
            form.add("parent_node", b.path("baseToken").asText());
            form.add("size", String.valueOf(a.bytes.length));
            form.add(
                    "file",
                    new ByteArrayResource(a.bytes) {
                        @Override
                        public String getFilename() {
                            return a.fileName;
                        }
                    });
            JsonNode upload =
                    api.call(
                            "https://open.feishu.cn/open-apis/drive/v1/medias/upload_all",
                            HttpMethod.POST,
                            form,
                            token,
                            MediaType.MULTIPART_FORM_DATA);
            String file = Protocol.required(upload.path("data"), "file_token");
            values.put(statusName, "生成成功");
            values.putArray(Protocol.required(attachment, "field_name"))
                    .addObject()
                    .put("file_token", file);
            update(b, token, values);
            jobs.succeed(id, file);
        } catch (Exception e) {
            String message = com.duowei.print.exception.SafeMessages.sanitize(e.getMessage());
            if (statusName != null)
                try {
                    ObjectNode values = Protocol.JSON.createObjectNode();
                    values.put(statusName, "生成失败");
                    if (errorName != null) values.put(errorName, message);
                    update(b, token, values);
                } catch (Exception ignored) {
                }
            jobs.fail(id, message);
        }
    }
}
