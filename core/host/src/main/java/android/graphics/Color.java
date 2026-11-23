package android.graphics;

public class Color {
    public static final int BLACK = 0xFF000000, WHITE = 0xFFFFFFFF, TRANSPARENT = 0, GRAY = 0xFF888888;
    public static int argb(int a, int r, int g, int b) { return (a << 24) | (r << 16) | (g << 8) | b; }
    public static int rgb(int r, int g, int b) { return argb(255, r, g, b); }
    public static int parseColor(String s) {
        String hex = s.startsWith("#") ? s.substring(1) : s;
        long v = Long.parseLong(hex, 16);
        return (int) (hex.length() == 6 ? v | 0xFF000000L : v);
    }
}
