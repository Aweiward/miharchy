package android.util;

/** android.util.Base64 on top of java.util.Base64. Decoding takes either alphabet, padded or not. */
public final class Base64 {
    public static final int DEFAULT = 0, NO_PADDING = 1, NO_WRAP = 2, CRLF = 4, URL_SAFE = 8, NO_CLOSE = 16;

    public static byte[] encode(byte[] input, int flags) {
        java.util.Base64.Encoder e = (flags & URL_SAFE) != 0 ? java.util.Base64.getUrlEncoder() : java.util.Base64.getEncoder();
        if ((flags & NO_PADDING) != 0) e = e.withoutPadding();
        byte[] out = e.encode(input);
        if ((flags & NO_WRAP) != 0) return out;
        // Android wraps at 76 chars and ends with a newline unless NO_WRAP.
        String s = new String(out, java.nio.charset.StandardCharsets.US_ASCII);
        String nl = (flags & CRLF) != 0 ? "\r\n" : "\n";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i += 76) sb.append(s, i, Math.min(s.length(), i + 76)).append(nl);
        return sb.toString().getBytes(java.nio.charset.StandardCharsets.US_ASCII);
    }

    public static String encodeToString(byte[] input, int flags) {
        return new String(encode(input, flags), java.nio.charset.StandardCharsets.US_ASCII);
    }

    public static byte[] decode(String str, int flags) {
        String s = str.replaceAll("\\s", "").replace('-', '+').replace('_', '/');
        while (s.length() % 4 != 0) s += "=";
        return java.util.Base64.getDecoder().decode(s);
    }

    public static byte[] decode(byte[] input, int flags) {
        return decode(new String(input, java.nio.charset.StandardCharsets.US_ASCII), flags);
    }
}
