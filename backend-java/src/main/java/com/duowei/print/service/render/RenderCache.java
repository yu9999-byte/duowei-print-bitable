package com.duowei.print.service.render;

import com.duowei.print.security.Protocol;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.concurrent.*;
import javax.annotation.PreDestroy;
import org.springframework.stereotype.Service;

/** Coalesces concurrent standard-mode renders and evicts failed attempts. */
@Service
public class RenderCache {
    private final RenderService renderer;
    private final ConcurrentMap<String, FutureTask<RenderService.Artifact>> cache =
            new ConcurrentHashMap<>();
    private final ExecutorService executor = Executors.newCachedThreadPool();

    public RenderCache(RenderService renderer) {
        this.renderer = renderer;
    }

    public RenderService.Artifact render(JsonNode body) {
        String key = Protocol.required(body, "artifactKey");
        FutureTask<RenderService.Artifact> candidate =
                new FutureTask<>(() -> renderer.render(body));
        FutureTask<RenderService.Artifact> task = cache.putIfAbsent(key, candidate);
        if (task == null) {
            task = candidate;
            executor.execute(task);
        }
        try {
            return task.get(90, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("生成文件已取消", e);
        } catch (TimeoutException e) {
            cache.remove(key, task);
            task.cancel(true);
            renderer.cancel(key);
            throw new IllegalStateException("生成文件超时，请稍后重试", e);
        } catch (CancellationException e) {
            cache.remove(key, task);
            throw new IllegalStateException("生成文件已取消", e);
        } catch (ExecutionException e) {
            cache.remove(key, task);
            throw new IllegalStateException("生成文件失败", e.getCause());
        }
    }

    @PreDestroy
    public void close() {
        cache.forEach(
                (key, task) -> {
                    if (!task.isDone()) {
                        task.cancel(true);
                        renderer.cancel(key);
                    }
                });
        executor.shutdownNow();
        cache.clear();
    }
}
