package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.duowei.print.integration.feishu.*;
import com.duowei.print.repository.AppTicketRepository;
import com.duowei.print.security.Protocol;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

class MarketplaceTokenTest {
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource(
            delimiter = '|',
            value = {
                "null|2",
                "true|2",
                "false|2",
                "\"\"|2",
                "[]|2",
                "[null]|2",
                "\"7200\"|1",
                "[7200]|1",
                "{}|1",
                "\"invalid\"|1",
                "1e20|1"
            })
    void expiryCoercionMatchesOriginalAndPreservesToken(String expiry, int calls) throws Exception {
        AppTicketRepository tickets = mock(AppTicketRepository.class);
        FeishuClient api = mock(FeishuClient.class);
        when(tickets.get("app")).thenReturn("ticket");
        when(api.post(endsWith("/app_access_token"), any(), isNull()))
                .thenReturn(
                        Protocol.JSON.readTree(
                                "{\"app_access_token\":\" app-token \",\"expire\":"
                                        + expiry
                                        + "}"));
        when(api.post(endsWith("/tenant_access_token"), any(), isNull()))
                .thenReturn(
                        Protocol.JSON.readTree(
                                "{\"tenant_access_token\":\" tenant-token \",\"expire\":"
                                        + expiry
                                        + "}"));
        MarketplaceTokenProvider provider =
                new MarketplaceTokenProvider("app", "secret", tickets, api, () -> 1000L);
        assertEquals(" tenant-token ", provider.getTenantAccessToken("tenant"));
        assertEquals(" tenant-token ", provider.getTenantAccessToken("tenant"));
        verify(api, times(calls)).post(endsWith("/app_access_token"), any(), isNull());
        verify(api, times(calls)).post(endsWith("/tenant_access_token"), any(), isNull());
        verify(api, atLeastOnce())
                .post(
                        endsWith("/tenant_access_token"),
                        argThat(
                                body ->
                                        " app-token "
                                                .equals(
                                                        ((com.fasterxml.jackson.databind.JsonNode)
                                                                        body)
                                                                .path("app_access_token")
                                                                .asText())),
                        isNull());
    }

    @Test
    void exchangesTicketCachesTokensAndRefreshesBeforeExpiry() throws Exception {
        AppTicketRepository tickets = mock(AppTicketRepository.class);
        FeishuClient api = mock(FeishuClient.class);
        AtomicLong now = new AtomicLong(1000);
        when(tickets.get("app")).thenReturn("ticket");
        when(api.post(endsWith("/app_access_token"), any(), isNull()))
                .thenReturn(
                        Protocol.JSON.readTree(
                                "{\"app_access_token\":\"app-token\",\"expire\":7200}"));
        when(api.post(endsWith("/tenant_access_token"), any(), isNull()))
                .thenReturn(
                        Protocol.JSON.readTree(
                                "{\"tenant_access_token\":\"tenant-token\",\"expire\":7200}"));
        MarketplaceTokenProvider provider =
                new MarketplaceTokenProvider("app", "secret", tickets, api, now::get);
        assertEquals("tenant-token", provider.getTenantAccessToken(" tenant "));
        assertEquals("tenant-token", provider.getTenantAccessToken("tenant"));
        verify(api, times(1))
                .post(
                        endsWith("/tenant_access_token"),
                        argThat(
                                body ->
                                        "tenant"
                                                .equals(
                                                        ((com.fasterxml.jackson.databind.JsonNode)
                                                                        body)
                                                                .path("tenant_key")
                                                                .asText())),
                        isNull());
        now.addAndGet(5400000);
        assertEquals("tenant-token", provider.getTenantAccessToken("tenant"));
        verify(tickets, times(2)).get("app");
        verify(api, times(2)).post(endsWith("/app_access_token"), any(), isNull());
    }

    @Test
    void isolatesTenantTokensWhileReusingApplicationToken() throws Exception {
        AppTicketRepository tickets = mock(AppTicketRepository.class);
        FeishuClient api = mock(FeishuClient.class);
        when(tickets.get("app")).thenReturn("ticket");
        when(api.post(endsWith("/app_access_token"), any(), isNull()))
                .thenReturn(
                        Protocol.JSON.readTree(
                                "{\"app_access_token\":\"application\",\"expire\":7200}"));
        when(api.post(endsWith("/tenant_access_token"), any(), isNull()))
                .thenAnswer(
                        invocation -> {
                            com.fasterxml.jackson.databind.JsonNode body =
                                    invocation.getArgument(1);
                            return Protocol.JSON
                                    .createObjectNode()
                                    .put(
                                            "tenant_access_token",
                                            "token-" + body.path("tenant_key").asText())
                                    .put("expire", 7200);
                        });
        MarketplaceTokenProvider provider =
                new MarketplaceTokenProvider("app", "secret", tickets, api, () -> 0L);
        assertEquals("token-first", provider.getTenantAccessToken("first"));
        assertEquals("token-second", provider.getTenantAccessToken("second"));
        assertEquals("token-first", provider.getTenantAccessToken("first"));
        verify(api, times(1)).post(endsWith("/app_access_token"), any(), isNull());
        verify(api, times(2)).post(endsWith("/tenant_access_token"), any(), isNull());
    }

    @Test
    void missingTicketStopsBeforeExternalExchange() {
        AppTicketRepository tickets = mock(AppTicketRepository.class);
        FeishuClient api = mock(FeishuClient.class);
        MarketplaceTokenProvider provider =
                new MarketplaceTokenProvider("app", "secret", tickets, api, () -> 0L);
        assertThrows(IllegalStateException.class, () -> provider.getTenantAccessToken("tenant"));
        verifyNoInteractions(api);
    }
}
