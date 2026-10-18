package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.duowei.print.security.Protocol;
import com.duowei.print.service.render.RenderCache;
import com.duowei.print.service.render.RenderService;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

class RenderTimeoutTest {
    @Test
    void laterWaiterUsesOriginalTaskDeadlineAfterFirstCallerDisconnects() throws Exception {
        RenderService renderer = mock(RenderService.class);
        ObjectNode body =
                Protocol.JSON.createObjectNode().put("artifactKey", "duowei:v1:shared-deadline");
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch callerExited = new CountDownLatch(1);
        when(renderer.render(body))
                .thenAnswer(
                        invocation -> {
                            started.countDown();
                            new CountDownLatch(1).await();
                            throw new AssertionError("unreachable");
                        });
        RenderCache cache = new RenderCache(renderer, 2000);
        Thread first =
                new Thread(
                        () -> {
                            try {
                                cache.render(body);
                            } catch (IllegalStateException expected) {
                                callerExited.countDown();
                            }
                        });
        try {
            first.start();
            assertTrue(started.await(5, TimeUnit.SECONDS));
            first.interrupt();
            assertTrue(callerExited.await(5, TimeUnit.SECONDS));
            Thread.sleep(1400);
            long joined = System.nanoTime();
            IllegalStateException failure =
                    assertThrows(IllegalStateException.class, () -> cache.render(body));
            long waited = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - joined);
            assertTrue(failure.getMessage().contains("超时"));
            assertTrue(waited < 1300, "late waiter restarted timeout: " + waited);
            verify(renderer, times(1)).render(body);
            verify(renderer).cancel("duowei:v1:shared-deadline");
        } finally {
            first.interrupt();
            first.join(5000);
            cache.close();
        }
    }

    @Test
    void closedServiceRejectsRequestsWithoutLeavingPendingCacheEntries() {
        RenderService renderer = mock(RenderService.class);
        RenderCache cache = new RenderCache(renderer);
        cache.close();
        ObjectNode body = Protocol.JSON.createObjectNode().put("artifactKey", "duowei:v1:closed");
        for (int attempt = 0; attempt < 2; attempt++) {
            IllegalStateException failure =
                    assertThrows(IllegalStateException.class, () -> cache.render(body));
            assertTrue(failure.getMessage().contains("已关闭"));
        }
        verifyNoInteractions(renderer);
    }

    @Test
    void shutdownCancelsActiveRenderAndReleasesWaitingCaller() throws Exception {
        RenderService renderer = mock(RenderService.class);
        ObjectNode body = Protocol.JSON.createObjectNode().put("artifactKey", "duowei:v1:shutdown");
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch interrupted = new CountDownLatch(1);
        when(renderer.render(body))
                .thenAnswer(
                        invocation -> {
                            started.countDown();
                            try {
                                new CountDownLatch(1).await();
                                throw new AssertionError("unreachable");
                            } catch (InterruptedException expected) {
                                interrupted.countDown();
                                throw new IllegalStateException("cancelled", expected);
                            }
                        });
        RenderCache cache = new RenderCache(renderer);
        java.util.concurrent.ExecutorService caller =
                java.util.concurrent.Executors.newSingleThreadExecutor();
        try {
            java.util.concurrent.Future<?> request = caller.submit(() -> cache.render(body));
            assertTrue(started.await(5, TimeUnit.SECONDS));
            cache.close();
            assertTrue(interrupted.await(5, TimeUnit.SECONDS));
            java.util.concurrent.ExecutionException failure =
                    assertThrows(
                            java.util.concurrent.ExecutionException.class,
                            () -> request.get(5, TimeUnit.SECONDS));
            assertTrue(failure.getCause().getMessage().contains("取消"));
            verify(renderer).cancel("duowei:v1:shutdown");
        } finally {
            cache.close();
            caller.shutdownNow();
        }
    }

    @Test
    void timeoutCancelsRendererEvictsFailureAndAllowsRetry() throws Exception {
        RenderService renderer = mock(RenderService.class);
        ObjectNode body = Protocol.JSON.createObjectNode().put("artifactKey", "duowei:v1:timeout");
        CountDownLatch interrupted = new CountDownLatch(1);
        RenderService.Artifact artifact = new RenderService.Artifact();
        when(renderer.render(body))
                .thenAnswer(
                        invocation -> {
                            try {
                                new CountDownLatch(1).await();
                                throw new AssertionError("unreachable");
                            } catch (InterruptedException expected) {
                                interrupted.countDown();
                                throw new IllegalStateException("cancelled", expected);
                            }
                        })
                .thenReturn(artifact);
        RenderCache cache = new RenderCache(renderer, 500);
        try {
            IllegalStateException failure =
                    assertThrows(IllegalStateException.class, () -> cache.render(body));
            assertTrue(failure.getMessage().contains("超时"));
            assertTrue(interrupted.await(5, TimeUnit.SECONDS));
            verify(renderer).cancel("duowei:v1:timeout");
            assertSame(artifact, cache.render(body));
            verify(renderer, times(2)).render(body);
        } finally {
            cache.close();
        }
    }
}
