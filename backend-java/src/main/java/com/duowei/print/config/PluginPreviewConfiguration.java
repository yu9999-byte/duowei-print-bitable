package com.duowei.print.config;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Optional local hosting of the existing plugin build; Feishu host APIs remain required. */
@Configuration
public class PluginPreviewConfiguration implements WebMvcConfigurer {
    private final String directory;

    public PluginPreviewConfiguration(
            @Value("${duowei.plugin-preview-directory:}") String directory) {
        this.directory = directory;
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        if (directory.trim().isEmpty()) return;
        Path root = Paths.get(directory).toAbsolutePath().normalize();
        if (!Files.isRegularFile(root.resolve("index.html"))) {
            throw new IllegalStateException("插件预览目录缺少index.html");
        }
        String location = root.toUri().toString();
        if (!location.endsWith("/")) location += "/";
        registry.addResourceHandler("/plugin-preview/**")
                .addResourceLocations(location)
                .setCachePeriod(0);
    }
}
