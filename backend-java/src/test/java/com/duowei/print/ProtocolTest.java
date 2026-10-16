package com.duowei.print;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class ProtocolTest {
 @Test void verifiesAndRejectsTampering() throws Exception {
  byte[] key=new byte[32]; java.util.Arrays.fill(key,(byte)42);
  com.fasterxml.jackson.databind.JsonNode body=Protocol.JSON.readTree("{\"z\":1,\"a\":\"中文\"}");
  assertEquals("{\"a\":\"中文\",\"z\":1}",Protocol.canonical(body));
  com.fasterxml.jackson.databind.node.ObjectNode claims=Protocol.JSON.createObjectNode();
  claims.put("version",1);claims.put("audience","test");claims.put("issuedAt",System.currentTimeMillis());claims.put("expiresAt",System.currentTimeMillis()+300000);claims.put("bodyDigest",Protocol.digest(Protocol.canonical(body)));
  String token=Protocol.sign("test-v1",claims,key);
  assertEquals("test",Protocol.verify(token,"test-v1","test",body,key).path("audience").asText());
  assertThrows(SecurityException.class,()->Protocol.verify(token,"test-v1","test",Protocol.JSON.createObjectNode(),key));
 }
 @Test void rejectsRuntimeAndCredentials() throws Exception {
  assertThrows(IllegalArgumentException.class,()->Protocol.safeSnapshot(Protocol.JSON.readTree("{\"nested\":{\"user_access_token\":\"secret\"}}")));
 }
}
