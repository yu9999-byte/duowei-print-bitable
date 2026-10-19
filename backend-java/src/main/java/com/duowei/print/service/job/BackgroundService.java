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
        worker.scheduleWithFixedDelay(this::drain, 0, workerInterval, TimeUnit.MILLISECONDS);
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
        synchronized (tokens) {
            tokens.clear();
            expires.clear();
        }
    }

    public ResponseEntity<?> submit(String signature, String token, ObjectNode body) {
        if (token.trim().length() < 20) throw new IllegalArgumentException("后台任务缺少临时租户凭证");
        body = normalizeSubmission(body);
        String key = body.path("taskKey").asText();
        Protocol.verifyBackground(
                signature,
                body,
                configuration.signingSecret("DUOWEI_BACKGROUND_JOB_SIGNING_SECRET_HEX"));
        boolean existing = jobs.exists(key);
        jobs.createOrRetry(key, body.toString());
        String tenant = body.path("tenantKey").asText();
        synchronized (tokens) {
            tokens.put(tenant, token.trim());
            expires.put(tenant, System.currentTimeMillis() + 5400000);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("jobId", key);
        result.put("status", jobs.status(key));
        result.put("reused", existing);
        String trace = UUID.randomUUID().toString();
        result.put("traceId", trace);
        try {
            worker.execute(this::drain);
        } catch (RejectedExecutionException ignored) {
            // Shutdown leaves the persisted job available for recovery on the next start.
        }
        return ResponseEntity.status(existing ? 200 : 202)
                .header("x-duowei-trace-id", trace)
                .body(result);
    }

    private static String requiredJob(JsonNode node, String field, String label) {
        if (!node.path(field).isTextual()
                || Protocol.trimJavaScript(node.path(field).textValue()).isEmpty())
            throw new IllegalArgumentException(label + "不能为空");
        return Protocol.trimJavaScript(node.path(field).textValue());
    }

    public static ObjectNode normalizeSubmission(ObjectNode body) {
        if (body == null) throw new IllegalArgumentException("后台任务请求必须是对象");
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
        while (names.hasNext())
            if (!allowed.contains(names.next()))
                throw new IllegalArgumentException("后台任务请求包含不支持的属性");
        if (!body.path("version").isNumber() || body.path("version").doubleValue() != 1.0)
            throw new IllegalArgumentException("后台任务版本无效");
        String key = requiredJob(body, "taskKey", "后台任务键");
        if (!key.matches("duowei-job:v1:[0-9a-f]{64}"))
            throw new IllegalArgumentException("后台任务键格式无效");
        String output = body.path("outputType").asText();
        if (!body.path("outputType").isTextual() || !Arrays.asList("pdf", "png").contains(output))
            throw new IllegalArgumentException("后台任务输出格式无效");
        JsonNode render = body.path("renderRequest");
        if (!body.path("outputType").equals(render.path("output").path("type")))
            throw new IllegalArgumentException("后台任务输出格式与渲染请求不一致");
        if (!render.path("artifactKey").isTextual()
                || !render.path("artifactKey").asText().startsWith("duowei:v1:"))
            throw new IllegalArgumentException("后台任务产物键无效");
        ObjectNode result = Protocol.JSON.createObjectNode();
        result.put("version", 1).put("taskKey", key);
        String[] fields = {"tenantKey", "baseToken", "tableId", "recordId"};
        String[] labels = {"租户", "多维表格", "数据表", "当前记录"};
        for (int i = 0; i < fields.length; i++)
            result.put(fields[i], requiredJob(body, fields[i], labels[i]));
        result.put("outputType", output);
        result.set("renderRequest", render.deepCopy());
        JsonNode targets = body.path("targets");
        if (!targets.isObject()) throw new IllegalArgumentException("后台任务字段配置无效");
        String attachment = requiredJob(targets, "attachmentFieldId", "附件字段");
        String status = requiredJob(targets, "statusFieldId", "状态字段");
        String error =
                targets.path("errorFieldId").isTextual()
                        ? Protocol.trimJavaScript(targets.path("errorFieldId").textValue())
                        : "";
        if (attachment.equals(status)
                || !error.isEmpty() && (error.equals(attachment) || error.equals(status)))
            throw new IllegalArgumentException("后台模式的附件、状态和错误字段不能重复");
        ObjectNode normalizedTargets = result.putObject("targets");
        normalizedTargets.put("attachmentFieldId", attachment).put("statusFieldId", status);
        if (!error.isEmpty()) normalizedTargets.put("errorFieldId", error);
        return result;
    }

    private void drain() {
        try {
            jobs.withWorkerLock(this::drainLocked);
        } catch (Exception e) {
            System.err.println("后台任务扫描失败：" + e.getClass().getSimpleName());
        }
    }

    private void drainLocked() {
        try {
            List<Map<String, Object>> recoverable = jobs.recoverable();
            for (Map<String, Object> row : recoverable) {
                JsonNode persisted = Protocol.JSON.readTree(row.get("submission").toString());
                if (!persisted.isObject()) throw new IllegalStateException("后台任务持久化内容无效");
                JsonNode body = normalizeSubmission((ObjectNode) persisted);
                String jobId = String.valueOf(row.get("job_id"));
                String taskKey = body.path("taskKey").asText();
                if (!(row.get("attempt") instanceof Number))
                    throw new IllegalStateException("后台任务持久化尝试次数无效");
                int attempt = Integer.parseInt(String.valueOf(row.get("attempt")));
                String status = row.get("status") == null ? "" : String.valueOf(row.get("status"));
                if (!jobId.equals(taskKey)
                        || !jobId.equals(row.get("task_key"))
                        || attempt < 0
                        || !Arrays.asList("queued", "processing").contains(status))
                    throw new IllegalStateException("后台任务持久化行无效");
                String tenant = body.path("tenantKey").asText();
                String token = tokenFor(tenant);
                if (token != null) process(jobId, body, token);
            }
        } catch (Exception e) {
            System.err.println("后台任务扫描失败：" + e.getClass().getSimpleName());
        }
    }

    private String tokenFor(String tenant) {
        synchronized (tokens) {
            if (expires.getOrDefault(tenant, 0L) <= System.currentTimeMillis()) {
                tokens.remove(tenant);
                expires.remove(tenant);
                return null;
            }
            return tokens.get(tenant);
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
        boolean uploadStarted = false;
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
                if (!data.isObject() || !data.path("items").isArray())
                    throw new IllegalStateException("读取字段列表返回格式无效");
                data.path("items")
                        .forEach(
                                f -> {
                                    if (f.isObject()
                                            && f.path("field_id").isTextual()
                                            && f.path("field_name").isTextual())
                                        fields.put(f.path("field_id").asText(), f);
                                });
                page =
                        data.path("has_more").isBoolean()
                                        && data.path("has_more").booleanValue()
                                        && data.path("page_token").isTextual()
                                ? data.path("page_token").textValue()
                                : "";
            } while (!page.isEmpty());
            JsonNode targets = b.path("targets"),
                    attachment = fields.get(targets.path("attachmentFieldId").asText()),
                    status = fields.get(targets.path("statusFieldId").asText()),
                    error = fields.get(targets.path("errorFieldId").asText());
            if (attachment == null
                    || attachment.path("type").asDouble(Double.NaN) != 17
                    || status == null
                    || status.path("type").asDouble(Double.NaN) != 1
                    || targets.has("errorFieldId")
                            && (error == null || error.path("type").asDouble(Double.NaN) != 1))
                throw new IllegalArgumentException("选择的字段不存在或类型已变化");
            statusName = status.path("field_name").textValue();
            errorName = error == null ? null : error.path("field_name").textValue();
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
            HttpHeaders fileHeaders = new HttpHeaders();
            fileHeaders.setContentType(MediaType.parseMediaType(a.contentType));
            form.add(
                    "file",
                    new HttpEntity<>(
                            new ByteArrayResource(a.bytes) {
                                @Override
                                public String getFilename() {
                                    return a.fileName;
                                }
                            },
                            fileHeaders));
            // Persist uncertainty before issuing the external side effect. A crash must not
            // automatically replay this upload, even when no file_token was received locally.
            if (!jobs.beforeUpload(id)) return;
            uploadStarted = true;
            JsonNode upload =
                    api.call(
                            "https://open.feishu.cn/open-apis/drive/v1/medias/upload_all",
                            HttpMethod.POST,
                            form,
                            token,
                            MediaType.MULTIPART_FORM_DATA);
            String file = Protocol.required(upload.path("data"), "file_token");
            values.put(statusName, "生成成功");
            values.putArray(attachment.path("field_name").textValue())
                    .addObject()
                    .put("file_token", file);
            update(b, token, values);
            jobs.succeed(id, file);
        } catch (Exception e) {
            String message = com.duowei.print.exception.SafeMessages.sanitize(e.getMessage());
            if (uploadStarted) {
                jobs.requireReview(id, "上传或回写结果不确定，请核对附件后恢复：" + message);
                return;
            }
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
