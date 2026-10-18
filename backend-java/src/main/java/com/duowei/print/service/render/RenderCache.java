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
    private final ConcurrentMap<String, RenderTask> cache = new ConcurrentHashMap<>();
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final long timeoutMillis;
    private final Object lifecycle = new Object();
    private boolean closed;

    private static final class RenderTask extends FutureTask<RenderService.Artifact> {
        private final long started = System.nanoTime();

        private RenderTask(Callable<RenderService.Artifact> render) {
            super(render);
        }
    }

    @org.springframework.beans.factory.annotation.Autowired
    public RenderCache(RenderService renderer) {
        this(renderer, 90000);
    }

    public RenderCache(RenderService renderer, long timeoutMillis) {
        if (timeoutMillis <= 0) throw new IllegalArgumentException("渲染超时必须为正数");
        this.renderer = renderer;
        this.timeoutMillis = timeoutMillis;
    }

    public RenderService.Artifact render(JsonNode body) {
        String key = Protocol.required(body, "artifactKey");
        RenderTask candidate = new RenderTask(() -> renderer.render(body));
        RenderTask task;
        synchronized (lifecycle) {
            if (closed) throw new IllegalStateException("渲染服务已关闭");
            task = cache.putIfAbsent(key, candidate);
            if (task == null) {
                task = candidate;
                try {
                    executor.execute(task);
                } catch (RejectedExecutionException rejected) {
                    cache.remove(key, task);
                    task.cancel(false);
                    throw new IllegalStateException("渲染服务已关闭", rejected);
                }
            }
        }
        try {
            long remaining =
                    TimeUnit.MILLISECONDS.toNanos(timeoutMillis)
                            - (System.nanoTime() - task.started);
            return task.get(Math.max(0, remaining), TimeUnit.NANOSECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("生成文件已取消", e);
        } catch (TimeoutException e) {
            synchronized (lifecycle) {
                if (cache.remove(key, task)) {
                    task.cancel(true);
                    renderer.cancel(key);
                }
            }
            throw new IllegalStateException("生成文件超时，请稍后重试", e);
        } catch (CancellationException e) {
            cache.remove(key, task);
            throw new IllegalStateException("生成文件已取消", e);
        } catch (ExecutionException e) {
            cache.remove(key, task);
            Throwable cause = e.getCause();
            String message = cause == null ? null : cause.getMessage();
            throw new IllegalStateException(
                    message == null || message.trim().isEmpty() ? "生成文件失败" : message, cause);
        }
    }

    @PreDestroy
    public void close() {
        synchronized (lifecycle) {
            closed = true;
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
}
