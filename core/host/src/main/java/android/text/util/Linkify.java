package android.text.util;

/** Links are a display concern, so nothing gets linked here. */
public class Linkify {
    public static final int WEB_URLS = 1, EMAIL_ADDRESSES = 2, PHONE_NUMBERS = 4, MAP_ADDRESSES = 8, ALL = 15;
    public static boolean addLinks(android.text.Spannable text, int mask) { return false; }
}
