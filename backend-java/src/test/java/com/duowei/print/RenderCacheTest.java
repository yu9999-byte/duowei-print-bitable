package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.duowei.print.security.Protocol;
import com.duowei.print.service.render.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

class RenderCacheTest {
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
