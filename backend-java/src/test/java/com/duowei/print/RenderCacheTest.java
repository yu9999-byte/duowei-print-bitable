package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.duowei.print.security.Protocol;
import com.duowei.print.service.render.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

class RenderCacheTest {
    @Test
    void concurrentRequestsShareOneRunningRender() throws Exception {
        RenderService renderer = mock(RenderService.class);
        ObjectNode body =
                Protocol.JSON.createObjectNode().put("artifactKey", "duowei:v1:concurrent");
        RenderService.Artifact artifact = new RenderService.Artifact();
        java.util.concurrent.CountDownLatch started = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
        when(renderer.render(body))
                .thenAnswer(
                        invocation -> {
                            started.countDown();
                            if (!release.await(5, java.util.concurrent.TimeUnit.SECONDS))
                                throw new IllegalStateException("test render did not release");
                            return artifact;
                        });
        RenderCache cache = new RenderCache(renderer);
        java.util.concurrent.ExecutorService callers =
                java.util.concurrent.Executors.newFixedThreadPool(2);
        try {
            java.util.concurrent.Future<RenderService.Artifact> first =
                    callers.submit(() -> cache.render(body));
            assertTrue(started.await(5, java.util.concurrent.TimeUnit.SECONDS));
            java.util.concurrent.Future<RenderService.Artifact> second =
                    callers.submit(() -> cache.render(body));
            release.countDown();
            assertSame(artifact, first.get(5, java.util.concurrent.TimeUnit.SECONDS));
            assertSame(artifact, second.get(5, java.util.concurrent.TimeUnit.SECONDS));
            verify(renderer, times(1)).render(body);
        } finally {
            release.countDown();
            callers.shutdownNow();
            cache.close();
        }
    }

    @Test
    void reusesSuccessfulArtifact() {
        RenderService renderer = mock(RenderService.class);
        ObjectNode body = Protocol.JSON.createObjectNode().put("artifactKey", "duowei:v1:test");
        RenderService.Artifact artifact = new RenderService.Artifact();
        when(renderer.render(body)).thenReturn(artifact);
        RenderCache cache = new RenderCache(renderer);
        try {
            assertSame(artifact, cache.render(body));
            assertSame(artifact, cache.render(body));
            verify(renderer, times(1)).render(body);
        } finally {
            cache.close();
        }
    }

    @Test
    void failedRenderCanBeRetried() {
        RenderService renderer = mock(RenderService.class);
        ObjectNode body = Protocol.JSON.createObjectNode().put("artifactKey", "duowei:v1:test");
        RenderService.Artifact artifact = new RenderService.Artifact();
        when(renderer.render(body))
                .thenThrow(new IllegalStateException("failure"))
                .thenReturn(artifact);
        RenderCache cache = new RenderCache(renderer);
        try {
            assertThrows(IllegalStateException.class, () -> cache.render(body));
            assertSame(artifact, cache.render(body));
            verify(renderer, times(2)).render(body);
        } finally {
            cache.close();
        }
    }
}
