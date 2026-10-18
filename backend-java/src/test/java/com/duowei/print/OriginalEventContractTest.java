package com.duowei.print;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.duowei.print.config.AutomationConfiguration;
import com.duowei.print.controller.AutomationController;
import com.duowei.print.repository.AppTicketRepository;
import com.duowei.print.security.Protocol;
import com.duowei.print.service.event.EventService;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class OriginalEventContractTest {
    @Test
    void matchesOriginalEventResponsesAndPersistenceCallsIncludingDuplicates() throws Exception {
        AppTicketRepository tickets = mock(AppTicketRepository.class);
        AutomationConfiguration config = mock(AutomationConfiguration.class);
        when(config.required("DUOWEI_EVENT_VERIFICATION_TOKEN")).thenReturn("local-test");
        when(config.required("DUOWEI_FEISHU_APP_ID")).thenReturn("cli_localtest");
        MockMvc mvc =
                MockMvcBuilders.standaloneSetup(
                                new AutomationController(
                                        null, null, new EventService(tickets, config)))
                        .addFilters(new com.duowei.print.config.RequestPolicy())
                        .build();
        for (JsonNode item :
                Protocol.JSON.readTree(getClass().getResourceAsStream("/event-contracts.json"))) {
            clearInvocations(tickets);
            MvcResult result =
                    mvc.perform(
                                    post("/openapi/duowei-print/events")
                                            .contentType("application/json")
                                            .content(item.path("body").toString()))
                            .andReturn();
            String id = item.path("id").asText();
            assertEquals(
                    item.path("expected").path("status").intValue(),
                    result.getResponse().getStatus(),
                    id);
            assertEquals(
                    item.path("expected").path("body"),
                    Protocol.JSON.readTree(result.getResponse().getContentAsByteArray()),
                    id);
            for (JsonNode ticket : item.path("expected").path("savedTickets"))
                verify(tickets).save("cli_localtest", ticket.asText());
            verifyNoMoreInteractions(tickets);
        }
    }
}
