package com.duowei.print.security;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Wire-compatible HMAC tokens used by the existing automation block. */
public final class Protocol {
    public static final ObjectMapper JSON = new ObjectMapper();

    private Protocol() {}

    public static String required(JsonNode node, String field) {
        JsonNode value = node.path(field);
        if (!value.isTextual() || value.asText().trim().isEmpty())
            throw new IllegalArgumentException(field + "不能为空");
        return value.asText().trim();
    }

    public static String canonical(JsonNode node) {
        if (node.isObject()) {
            TreeMap<String, JsonNode> sorted = new TreeMap<>();
            node.fields().forEachRemaining(e -> sorted.put(e.getKey(), e.getValue()));
            StringJoiner out = new StringJoiner(",", "{", "}");
            sorted.forEach((key, value) -> out.add(quote(key) + ":" + canonical(value)));
            return out.toString();
        }
        if (node.isArray()) {
            StringJoiner out = new StringJoiner(",", "[", "]");
            node.forEach(value -> out.add(canonical(value)));
            return out.toString();
        }
        if (node.isNumber()) {
            double number = node.doubleValue();
            if (!Double.isFinite(number)) throw new IllegalArgumentException("请求包含不可序列化数值");
            if (number == 0) return "0";
            java.math.BigDecimal decimal = shortestDecimal(number);
            double absolute = Math.abs(number);
            if (absolute >= 1e-6 && absolute < 1e21) return decimal.toPlainString();
            String scientific = decimal.toString().replace("E", "e");
            if (!scientific.contains("e")) return scientific;
            String[] parts = scientific.split("e");
            int exponent = Integer.parseInt(parts[1]);
            return parts[0] + "e" + (exponent >= 0 ? "+" : "") + exponent;
        }
        return node.toString();
    }

    private static String quote(String text) {
        return new TextNode(text).toString();
    }

    /** Finds the nearest shortest decimal that round-trips to this IEEE-754 value. */
    private static java.math.BigDecimal shortestDecimal(double number) {
        java.math.BigDecimal exact = new java.math.BigDecimal(number);
        for (int precision = 1; precision <= 17; precision++) {
            java.math.BigDecimal rounded =
                    exact.round(
                            new java.math.MathContext(precision, java.math.RoundingMode.HALF_EVEN));
            java.math.BigDecimal unit = rounded.ulp();
            java.math.BigDecimal best = null;
            java.math.BigDecimal distance = null;
            for (int offset = -1; offset <= 1; offset++) {
                java.math.BigDecimal candidate =
                        rounded.add(unit.multiply(java.math.BigDecimal.valueOf(offset)))
                                .stripTrailingZeros();
                if (candidate.precision() > precision || candidate.doubleValue() != number)
                    continue;
                java.math.BigDecimal difference = candidate.subtract(exact).abs();
                if (best == null
                        || difference.compareTo(distance) < 0
                        || difference.compareTo(distance) == 0
                                && !candidate.unscaledValue().testBit(0)) {
                    best = candidate;
                    distance = difference;
                }
            }
            if (best != null) return best;
        }
        throw new IllegalArgumentException("数值无法规范化");
    }

    public static String encode(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    public static String digest(String text) {
        try {
            return encode(
                    MessageDigest.getInstance("SHA-256")
                            .digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static byte[] hmac(byte[] secret, String text) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret, "HmacSHA256"));
        return mac.doFinal(text.getBytes(StandardCharsets.UTF_8));
    }

    public static byte[] secret(String variable) {
        String hex = System.getenv(variable);
        if (hex == null || !hex.matches("(?i)[0-9a-f]{64,}") || hex.length() % 2 != 0)
            throw new IllegalStateException(variable + "必须是至少32字节的十六进制密钥");
        byte[] result = new byte[hex.length() / 2];
        for (int i = 0; i < result.length; i++)
            result[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        return result;
    }

    public static String sign(String prefix, ObjectNode claims, byte[] secret) {
        try {
            String payload =
                    prefix + "." + encode(canonical(claims).getBytes(StandardCharsets.UTF_8));
            return payload + "." + encode(hmac(secret, payload));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    public static JsonNode verify(
            String token, String prefix, String audience, JsonNode body, byte[] secret) {
        try {
            String[] parts = token.trim().split("\\.", -1);
            if (parts.length != 3
                    || !prefix.equals(parts[0])
                    || !MessageDigest.isEqual(
                            hmac(secret, parts[0] + "." + parts[1]),
                            Base64.getUrlDecoder().decode(parts[2])))
                throw new IllegalArgumentException();
            JsonNode claims = JSON.readTree(Base64.getUrlDecoder().decode(parts[1]));
            long now = System.currentTimeMillis();
            if (!claims.path("version").isNumber()
                    || claims.path("version").doubleValue() != 1.0
                    || !audience.equals(claims.path("audience").asText())
                    || !claims.path("expiresAt").isNumber()
                    || !claims.path("issuedAt").isNumber()
                    || claims.path("expiresAt").doubleValue() < now
                    || claims.path("issuedAt").doubleValue() > now + 30000
                    || !digest(canonical(body)).equals(claims.path("bodyDigest").asText()))
                throw new IllegalArgumentException();
            return claims;
        } catch (Exception e) {
            throw new SecurityException("身份签名无效或已过期");
        }
    }

    public static void safeSnapshot(JsonNode node) {
        if (node == null
                || node.isMissingNode()
                || node.isNumber() && !Double.isFinite(node.doubleValue()))
            throw new IllegalArgumentException("自动化模板包含不可序列化数据");
        if (node.isObject())
            node.fields()
                    .forEachRemaining(
                            e -> {
                                String key =
                                        e.getKey()
                                                .replace("-", "")
                                                .replace("_", "")
                                                .toLowerCase(Locale.ROOT);
                                if (Arrays.asList(
                                                        "authorization",
                                                        "appsecret",
                                                        "clientsecret",
                                                        "password",
                                                        "refreshtoken",
                                                        "documents",
                                                        "recorddata",
                                                        "recordid",
                                                        "recordids",
                                                        "records",
                                                        "recordvalues",
                                                        "runtimevalues",
                                                        "testdata",
                                                        "variables")
                                                .contains(key)
                                        || key.endsWith("accesstoken"))
                                    throw new IllegalArgumentException("自动化模板包含敏感凭据或运行数据");
                                safeSnapshot(e.getValue());
                            });
        else if (node.isArray()) node.forEach(Protocol::safeSnapshot);
    }
}
