package android.widget;

/** There's no toast to show on desktop, so the message goes to the host's log. */
public class Toast {
    public static final int LENGTH_SHORT = 0, LENGTH_LONG = 1;
    private CharSequence text;
    private Toast(CharSequence text) { this.text = text; }
    public static Toast makeText(android.content.Context context, CharSequence text, int duration) { return new Toast(text); }
    public static Toast makeText(android.content.Context context, int resId, int duration) { return new Toast(""); }
    public void setText(CharSequence s) { text = s; }
    public void show() { System.err.println("toast: " + text); }
    public void cancel() {}
}
