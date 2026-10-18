package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;

import com.duowei.print.config.PluginPreviewConfiguration;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockServletContext;
import org.springframework.web.context.support.StaticWebApplicationContext;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;

class PluginPreviewConfigurationTest {
    @TempDir Path directory;

    @Test
    void servesPluginBuildAndRejectsParentTraversal() throws Exception {
        Files.write(
                directory.resolve("index.html"),
                "<title>多维打印</title>".getBytes(StandardCharsets.UTF_8));
        Files.createDirectories(directory.resolve("assets"));
        Files.write(
                directory.resolve("assets/main.js"),
                "window.preview=true;".getBytes(StandardCharsets.UTF_8));
        org.springframework.web.servlet.resource.ResourceHttpRequestHandler handler =
                new org.springframework.web.servlet.resource.ResourceHttpRequestHandler();
        handler.setServletContext(new MockServletContext());
        handler.setLocations(
                java.util.Collections.singletonList(
                        new org.springframework.core.io.FileSystemResource(
                                directory.toString() + "/")));
        handler.afterPropertiesSet();
        for (String path : java.util.Arrays.asList("index.html", "assets/main.js")) {
            org.springframework.mock.web.MockHttpServletRequest request =
                    new org.springframework.mock.web.MockHttpServletRequest(
                            "GET", "/plugin-preview/" + path);
            request.setAttribute(
                    org.springframework.web.servlet.HandlerMapping
                            .PATH_WITHIN_HANDLER_MAPPING_ATTRIBUTE,
                    path);
            org.springframework.mock.web.MockHttpServletResponse response =
                    new org.springframework.mock.web.MockHttpServletResponse();
            handler.handleRequest(request, response);
            assertEquals(200, response.getStatus());
            assertArrayEquals(
                    Files.readAllBytes(directory.resolve(path)), response.getContentAsByteArray());
        }
        org.springframework.mock.web.MockHttpServletRequest request =
                new org.springframework.mock.web.MockHttpServletRequest(
                        "GET", "/plugin-preview/../secret");
        request.setAttribute(
                org.springframework.web.servlet.HandlerMapping
                        .PATH_WITHIN_HANDLER_MAPPING_ATTRIBUTE,
                "../secret");
        org.springframework.mock.web.MockHttpServletResponse response =
                new org.springframework.mock.web.MockHttpServletResponse();
        handler.handleRequest(request, response);
        assertEquals(404, response.getStatus());
    }

    @Test
    void previewIsOptInAndRejectsMissingBuild() throws Exception {
        StaticWebApplicationContext context = new StaticWebApplicationContext();
        MockServletContext servlet = new MockServletContext();
        context.setServletContext(servlet);
        ResourceHandlerRegistry registry = new ResourceHandlerRegistry(context, servlet);
        new PluginPreviewConfiguration("").addResourceHandlers(registry);
        assertFalse(registry.hasMappingForPattern("/plugin-preview/**"));
        assertThrows(
                IllegalStateException.class,
                () ->
                        new PluginPreviewConfiguration(directory.toString())
                                .addResourceHandlers(registry));
        Files.write(
                directory.resolve("index.html"),
                "<div id=app></div>".getBytes(StandardCharsets.UTF_8));
        new PluginPreviewConfiguration(directory.toString()).addResourceHandlers(registry);
        assertTrue(registry.hasMappingForPattern("/plugin-preview/**"));
        assertFalse(registry.hasMappingForPattern("/api/**"));
        context.close();
    }
}
