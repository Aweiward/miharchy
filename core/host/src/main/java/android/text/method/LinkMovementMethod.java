package android.text.method;

public class LinkMovementMethod implements MovementMethod {
    private static final LinkMovementMethod INSTANCE = new LinkMovementMethod();
    public static MovementMethod getInstance() { return INSTANCE; }
}
