package android.webkit;

public final class URLUtil {
    public static boolean isHttpUrl(String url) { return url != null && url.regionMatches(true, 0, "http://", 0, 7); }
    public static boolean isHttpsUrl(String url) { return url != null && url.regionMatches(true, 0, "https://", 0, 8); }
    public static boolean isNetworkUrl(String url) { return isHttpUrl(url) || isHttpsUrl(url); }
    public static boolean isValidUrl(String url) {
        if (url == null || url.isEmpty()) return false;
        String u = url.toLowerCase();
        return isNetworkUrl(url) || u.startsWith("file://") || u.startsWith("data:") || u.startsWith("about:") || u.startsWith("javascript:") || u.startsWith("content:");
    }
    public static String guessFileName(String url, String contentDisposition, String mimeType) {
        String path = url == null ? "" : url.replaceAll("[?#].*", "");
        String name = path.substring(path.lastIndexOf('/') + 1);
        return name.isEmpty() ? "downloadfile" : name;
    }
}
