package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.duowei.print.config.AutomationConfiguration;
import com.duowei.print.repository.AppTicketRepository;
import com.duowei.print.security.Protocol;
import com.duowei.print.service.event.EventService;
import org.junit.jupiter.api.Test;

class EventServiceTest {
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(
            strings = {"[]", "null", "42", "{\"token\":123}"})
    void rejectsNonObjectEventsAndCoercedVerificationTokens(String json) throws Exception {
        AppTicketRepository tickets = mock(AppTicketRepository.class);
        AutomationConfiguration config = mock(AutomationConfiguration.class);
        when(config.required("DUOWEI_EVENT_VERIFICATION_TOKEN")).thenReturn("123");
        org.springframework.http.ResponseEntity<?> response =
                new EventService(tickets, config).event(Protocol.JSON.readTree(json));
        assertEquals(json.startsWith("{") ? 401 : 400, response.getStatusCodeValue());
        assertEquals(
                json.startsWith("{") ? "VERIFICATION_FAILED" : "JSON_INVALID",
                ((java.util.Map<?, ?>) response.getBody()).get("code"));
        verifyNoInteractions(tickets);
    }

    @Test
    void preservesChallengeAndRejectsEmptyTicketWithOriginalErrorCode() throws Exception {
        AppTicketRepository tickets = mock(AppTicketRepository.class);
        AutomationConfiguration config = mock(AutomationConfiguration.class);
        when(config.required("DUOWEI_EVENT_VERIFICATION_TOKEN")).thenReturn("test-token");
        when(config.required("DUOWEI_FEISHU_APP_ID")).thenReturn("cli_expected");
        EventService service = new EventService(tickets, config);
        org.springframework.http.ResponseEntity<?> challenge =
                service.event(
                        Protocol.JSON.readTree(
                                "{\"token\":\"test-token\",\"type\":\"url_verification\",\"challenge\":\" spaced \"}"));
        assertEquals(" spaced ", ((java.util.Map<?, ?>) challenge.getBody()).get("challenge"));
        org.springframework.http.ResponseEntity<?> invalid =
                service.event(
                        Protocol.JSON.readTree(
                                "{\"token\":\"test-token\",\"event\":{\"type\":\"app_ticket\",\"app_id\":\"cli_expected\",\"app_ticket\":\" \"}}"));
        assertEquals(400, invalid.getStatusCodeValue());
        assertEquals("APP_TICKET_INVALID", ((java.util.Map<?, ?>) invalid.getBody()).get("code"));
        verifyNoInteractions(tickets);
    }

    @Test
    void acceptsChallengeWithoutWritingTicket() throws Exception {
        AppTicketRepository tickets = mock(AppTicketRepository.class);
        AutomationConfiguration config = mock(AutomationConfiguration.class);
        when(config.required("DUOWEI_EVENT_VERIFICATION_TOKEN")).thenReturn("test-token");
        EventService service = new EventService(tickets, config);
        org.springframework.http.ResponseEntity<?> result =
                service.event(
                        Protocol.JSON.readTree(
                                "{\"token\":\"test-token\",\"type\":\"url_verification\",\"challenge\":\"challenge\"}"));
        assertEquals(200, result.getStatusCodeValue());
        assertEquals("challenge", ((java.util.Map<?, ?>) result.getBody()).get("challenge"));
        verifyNoInteractions(tickets);
    }

    @Test
    void rejectsWrongTokenAndForeignAppBeforePersistence() throws Exception {
        AppTicketRepository tickets = mock(AppTicketRepository.class);
        AutomationConfiguration config = mock(AutomationConfiguration.class);
        when(config.required("DUOWEI_EVENT_VERIFICATION_TOKEN")).thenReturn("test-token");
        when(config.required("DUOWEI_FEISHU_APP_ID")).thenReturn("cli_expected");
        EventService service = new EventService(tickets, config);
        assertEquals(
                401,
                service.event(Protocol.JSON.readTree("{\"token\":\"wrong\"}"))
                        .getStatusCodeValue());
        assertEquals(
                400,
                service.event(
                                Protocol.JSON.readTree(
                                        "{\"token\":\"test-token\",\"event\":{\"type\":\"app_ticket\",\"app_id\":\"cli_other\",\"app_ticket\":\"ticket\"}}"))
                        .getStatusCodeValue());
        verifyNoInteractions(tickets);
    }

    @Test
    void persistsVerifiedTicket() throws Exception {
        AppTicketRepository tickets = mock(AppTicketRepository.class);
        AutomationConfiguration config = mock(AutomationConfiguration.class);
        when(config.required("DUOWEI_EVENT_VERIFICATION_TOKEN")).thenReturn("test-token");
        when(config.required("DUOWEI_FEISHU_APP_ID")).thenReturn("cli_expected");
        EventService service = new EventService(tickets, config);
        assertEquals(
                200,
                service.event(
                                Protocol.JSON.readTree(
                                        "{\"token\":\"test-token\",\"event\":{\"type\":\"app_ticket\",\"app_id\":\"cli_expected\",\"app_ticket\":\"ticket\"}}"))
                        .getStatusCodeValue());
        verify(tickets).save("cli_expected", "ticket");
    }
}
