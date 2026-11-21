package android.text;

/** The text, with spans accepted and kept out of the way, since nothing on desktop draws them. */
public class SpannableString implements Spannable {
    private final String text;
    public SpannableString(CharSequence source) { text = source.toString(); }
    public static SpannableString valueOf(CharSequence source) { return source instanceof SpannableString s ? s : new SpannableString(source); }
    @Override public void setSpan(Object what, int start, int end, int flags) {}
    @Override public int length() { return text.length(); }
    @Override public char charAt(int i) { return text.charAt(i); }
    @Override public CharSequence subSequence(int start, int end) { return new SpannableString(text.substring(start, end)); }
    @Override public String toString() { return text; }
}
