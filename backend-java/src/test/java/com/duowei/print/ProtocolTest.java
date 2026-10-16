package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;

import com.duowei.print.security.Protocol;
import org.junit.jupiter.api.Test;

class ProtocolTest {
    @Test
    void rejectsSignedFractionalAndStringVersions() {
        byte[] key = new byte[32];
        com.fasterxml.jackson.databind.node.ObjectNode body = Protocol.JSON.createObjectNode();
        com.fasterxml.jackson.databind.node.ObjectNode claims = Protocol.JSON.createObjectNode();
        claims.put("audience", "test");
        claims.put("issuedAt", System.currentTimeMillis());
        claims.put("expiresAt", System.currentTimeMillis() + 300000);
        claims.put("bodyDigest", Protocol.digest(Protocol.canonical(body)));
        claims.put("version", 1.5);
        String fractional = Protocol.sign("test-v1", claims, key);
        assertThrows(
                SecurityException.class,
                () -> Protocol.verify(fractional, "test-v1", "test", body, key));
        claims.put("version", "1");
        String textual = Protocol.sign("test-v1", claims, key);
        assertThrows(
                SecurityException.class,
                () -> Protocol.verify(textual, "test-v1", "test", body, key));
    }

    @Test
    void matchesNodeSha256Vector() throws Exception {
        String canonical =
                Protocol.canonical(
                        Protocol.JSON.readTree(
                                "{\"z\":[1,-0.0,0.000001,0.0000001,1e21],\"a\":\"中文\"}"));
        assertEquals("{\"a\":\"中文\",\"z\":[1,0,0.000001,1e-7,1e+21]}", canonical);
        assertEquals("i7HYEwhQl9x4rgHi1jYfjK-QTRKcAmv4H_vzcgO2W9I", Protocol.digest(canonical));
    }

    @Test
    void verifiesAndRejectsTampering() throws Exception {
        byte[] key = new byte[32];
        java.util.Arrays.fill(key, (byte) 42);
        com.fasterxml.jackson.databind.JsonNode body =
                Protocol.JSON.readTree("{\"z\":1,\"a\":\"中文\"}");
        assertEquals("{\"a\":\"中文\",\"z\":1}", Protocol.canonical(body));
        com.fasterxml.jackson.databind.node.ObjectNode claims = Protocol.JSON.createObjectNode();
        claims.put("version", 1);
        claims.put("audience", "test");
        claims.put("issuedAt", System.currentTimeMillis());
        claims.put("expiresAt", System.currentTimeMillis() + 300000);
        claims.put("bodyDigest", Protocol.digest(Protocol.canonical(body)));
        String token = Protocol.sign("test-v1", claims, key);
        assertEquals(
                "test",
                Protocol.verify(token, "test-v1", "test", body, key).path("audience").asText());
        assertThrows(
                SecurityException.class,
                () ->
                        Protocol.verify(
                                token, "test-v1", "test", Protocol.JSON.createObjectNode(), key));
    }

    @Test
    void rejectsRuntimeAndCredentials() throws Exception {
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        Protocol.safeSnapshot(
                                Protocol.JSON.readTree(
                                        "{\"nested\":{\"user_access_token\":\"secret\"}}")));
    }

    @Test
    void canonicalNumbersMatchJavaScriptThresholds() throws Exception {
        assertEquals(
                "[1,0,0.000001,1e-7,1e+21]",
                Protocol.canonical(Protocol.JSON.readTree("[1.0,-0.0,0.000001,0.0000001,1e21]")));
    }

    @Test
    void rejectsMissingAndNonFiniteSnapshots() {
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        Protocol.safeSnapshot(
                                com.fasterxml.jackson.databind.node.MissingNode.getInstance()));
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        Protocol.safeSnapshot(
                                com.fasterxml.jackson.databind.node.DoubleNode.valueOf(
                                        Double.NaN)));
        assertDoesNotThrow(
                () -> Protocol.safeSnapshot(com.fasterxml.jackson.databind.node.NullNode.instance));
    }
}
