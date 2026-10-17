package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.duowei.print.config.AutomationConfiguration;
import com.duowei.print.repository.TemplateStore;
import com.duowei.print.security.Protocol;
import com.duowei.print.service.registry.RegistryService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.*;
import org.junit.jupiter.api.Test;

class RegistryServiceTest {
    private String token(JsonNode body, boolean write, byte[] key) {
        ObjectNode claims = Protocol.JSON.createObjectNode();
        claims.put("version", 1);
        claims.put(
                "audience",
                write ? "duowei-template-registry-write" : "duowei-template-registry-read");
        claims.put("issuedAt", System.currentTimeMillis());
        claims.put("expiresAt", System.currentTimeMillis() + 300000);
        claims.put("bodyDigest", Protocol.digest(Protocol.canonical(body)));
        claims.put("canWrite", true);
        for (String field : Arrays.asList("tenantKey", "baseToken", "tableId"))
            claims.put(field, body.path("scope").path(field).asText());
        return Protocol.sign(write ? "duowei-registry-v1" : "duowei-registry-read-v1", claims, key);
    }

    @Test
    void verifiedReadsReturnTemplatesAndTamperingDoesNotReachDatabase() throws Exception {
        byte[] key = new byte[32];
        Arrays.fill(key, (byte) 17);
        TemplateStore store = mock(TemplateStore.class);
        AutomationConfiguration config = mock(AutomationConfiguration.class);
        when(config.signingSecret(anyString())).thenReturn(key);
        RegistryService service = new RegistryService(store, config);
        ObjectNode body =
                (ObjectNode)
                        Protocol.JSON.readTree(
                                "{\"operation\":\"list\",\"scope\":{\"tenantKey\":\"tenant\",\"baseToken\":\"base\",\"tableId\":\"table\"}}");
        when(store.read(body)).thenReturn(Collections.emptyList());
        String signature = token(body, false, key);
        assertTrue(
                ((JsonNode) service.execute(body, signature).getBody())
                        .path("templates")
                        .isArray());
        verify(store).read(body);
        ((ObjectNode) body.path("scope")).put("tableId", "other");
        assertThrows(SecurityException.class, () -> service.execute(body, signature));
        verifyNoMoreInteractions(store);
    }

    @Test
    void verifiedWritesPreserveScopeAndReturnNoContent() throws Exception {
        byte[] key = new byte[32];
        TemplateStore store = mock(TemplateStore.class);
        AutomationConfiguration config = mock(AutomationConfiguration.class);
        when(config.signingSecret(anyString())).thenReturn(key);
        RegistryService service = new RegistryService(store, config);
        JsonNode body =
                Protocol.JSON.readTree(
                        "{\"scope\":{\"tenantKey\":\"tenant\",\"baseToken\":\"base\",\"tableId\":\"table\"},\"template\":{\"id\":\"template\",\"revision\":\"r1\",\"name\":\"发货单\",\"snapshot\":{\"pages\":[]},\"referencedFieldIds\":[]}}");
        assertEquals(204, service.execute(body, token(body, true, key)).getStatusCodeValue());
        verify(store).upsert(body);
        clearInvocations(store);
        ObjectNode invalid = ((ObjectNode) body).deepCopy();
        ((ObjectNode) invalid.path("template")).putArray("referencedFieldIds").add(42);
        assertThrows(
                IllegalArgumentException.class,
                () -> service.execute(invalid, token(invalid, true, key)));
        verifyNoInteractions(store);
    }
}
