package com.duowei.print.config;

import java.io.*;
import java.util.*;
import javax.servlet.*;
import javax.servlet.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class RequestPolicy extends OncePerRequestFilter {
    private final AutomationConfiguration configuration;

    @org.springframework.beans.factory.annotation.Autowired
    public RequestPolicy(AutomationConfiguration configuration) {
        this.configuration = configuration;
    }

    public RequestPolicy() {
        this(new AutomationConfiguration());
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("X-Duowei-Trace-Id", UUID.randomUUID().toString());
        String origin = req.getHeader("Origin");
        Set<String> configured =
                origin == null ? Collections.emptySet() : configuration.allowedOrigins();
        String renderUrl = origin == null ? null : configuration.required("DUOWEI_RENDER_PAGE_URL");
        boolean sameService =
                renderUrl != null
                        && origin != null
                        && java.net
                                .URI
                                .create(renderUrl)
                                .resolve("/")
                                .toString()
                                .replaceAll("/$", "")
                                .equals(origin);
        if (origin != null && !sameService && !configured.contains(origin)) {
            res.sendError(403);
            return;
        }
        if (origin != null && (sameService || configured.contains(origin))) {
            res.setHeader("Access-Control-Allow-Origin", origin);
            res.setHeader("Access-Control-Allow-Credentials", "true");
            res.setHeader("Vary", "Origin");
            res.setHeader(
                    "Access-Control-Allow-Headers",
                    "authorization,content-type,x-duowei-service-signature,x-duowei-plugin-origin");
            res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
            if ("OPTIONS".equals(req.getMethod())) {
                res.setStatus(204);
                return;
            }
        }
        if ("POST".equals(req.getMethod())) {
            if (req.getContentType() == null
                    || !req.getContentType()
                            .toLowerCase(Locale.ROOT)
                            .startsWith("application/json")) {
                res.sendError(415);
                return;
            }
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] block = new byte[8192];
            int count;
            try (InputStream in = req.getInputStream()) {
                while ((count = in.read(block)) != -1) {
                    if (buffer.size() + count > 2 * 1024 * 1024) {
                        res.sendError(413);
                        return;
                    }
                    buffer.write(block, 0, count);
                }
            }
            final byte[] bytes = buffer.toByteArray();
            HttpServletRequestWrapper wrapped =
                    new HttpServletRequestWrapper(req) {
                        @Override
                        public ServletInputStream getInputStream() {
                            ByteArrayInputStream input = new ByteArrayInputStream(bytes);
                            return new ServletInputStream() {
                                public int read() {
                                    return input.read();
                                }

                                public boolean isFinished() {
                                    return input.available() == 0;
                                }

                                public boolean isReady() {
                                    return true;
                                }

                                public void setReadListener(ReadListener listener) {
                                    throw new UnsupportedOperationException(
                                            "Async input is not supported");
                                }
                            };
                        }

                        @Override
                        public BufferedReader getReader() {
                            return new BufferedReader(
                                    new InputStreamReader(
                                            getInputStream(),
                                            java.nio.charset.StandardCharsets.UTF_8));
                        }
                    };
            chain.doFilter(wrapped, res);
            return;
        }
        chain.doFilter(req, res);
    }
}
