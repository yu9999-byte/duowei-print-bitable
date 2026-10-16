package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;

import com.duowei.print.security.Protocol;
import com.duowei.print.service.render.RenderRequestService;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

class RenderNormalizationTest {
    private ObjectNode request() {
        ObjectNode root = Protocol.JSON.createObjectNode();
        root.put("artifactKey", " key ");
        ObjectNode template = root.putObject("template");
        template.put("id", " id ");
        template.put("revision", " rev ");
        template.putObject("snapshot");
        root.putObject("values");
        root.putObject("output").put("type", "pdf").putNull("pageLimit");
        return root;
    }

    @Test
    void normalizesIdentityAndDropsExtensionFieldsWithoutMutatingInput() {
        ObjectNode input = request();
        input.put("extra", true);
        com.fasterxml.jackson.databind.JsonNode result = RenderRequestService.normalize(input);
        assertEquals("key", result.path("artifactKey").asText());
        assertEquals("id", result.path("template").path("id").asText());
        assertFalse(result.has("extra"));
        assertTrue(input.has("extra"));
    }

    @Test
    void rejectsFractionalPageLimitAndCredentials() {
        ObjectNode input = request();
        ((ObjectNode) input.path("output")).put("type", "png").put("pageLimit", 1.5);
        assertThrows(IllegalArgumentException.class, () -> RenderRequestService.normalize(input));
        ((ObjectNode) input.path("output")).put("pageLimit", 1);
        ((ObjectNode) input.path("values")).put("user_access_token", "secret");
        assertThrows(IllegalArgumentException.class, () -> RenderRequestService.normalize(input));
    }
}
