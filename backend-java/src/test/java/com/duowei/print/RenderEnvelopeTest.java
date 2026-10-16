package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;

import com.duowei.print.security.Protocol;
import com.duowei.print.service.render.RenderService;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

class RenderEnvelopeTest {
    @Test
    void rejectsCoercedVersionFractionalPageCountAndNonArrayBytes() throws Exception {
        ObjectNode result =
                (ObjectNode)
                        Protocol.JSON.readTree(
                                "{\"protocolVersion\":1,\"pageCount\":1,\"bytes\":[37,80,68,70,45]}");
        assertDoesNotThrow(() -> RenderService.validateEnvelope(result));
        result.put("protocolVersion", 1.5);
        assertThrows(IllegalStateException.class, () -> RenderService.validateEnvelope(result));
        result.put("protocolVersion", "1");
        assertThrows(IllegalStateException.class, () -> RenderService.validateEnvelope(result));
        result.put("protocolVersion", 1).put("pageCount", 1.5);
        assertThrows(IllegalStateException.class, () -> RenderService.validateEnvelope(result));
        result.put("pageCount", 1).putObject("bytes");
        assertThrows(IllegalStateException.class, () -> RenderService.validateEnvelope(result));
    }
}
