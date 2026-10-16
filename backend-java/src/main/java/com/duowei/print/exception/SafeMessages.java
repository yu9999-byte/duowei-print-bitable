package com.duowei.print.exception;

/** Redacts credentials before returning third-party errors to the caller. */
public final class SafeMessages {
    private SafeMessages() {}

    public static String sanitize(String value) {
        if (value == null || value.trim().isEmpty()) return "请求失败，请重试";
        String safe =
                value.replaceAll("(?i)Bearer\\s+[^\\s,;]+", "Bearer [已隐藏]")
                        .replaceAll(
                                "(?i)((?:client[_-]?secret|(?:tenant|user)?[_-]?access[_-]?token)\\s*[=:]\\s*)[^\\s,;]+",
                                "$1[已隐藏]");
        return safe.substring(0, Math.min(500, safe.length()));
    }
}
