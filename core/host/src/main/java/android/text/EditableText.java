package android.text;

/** The Editable a TextView hands out. */
public final class EditableText implements Editable {
    private final StringBuilder text = new StringBuilder();
    public EditableText(CharSequence initial) { if (initial != null) text.append(initial); }
    @Override public Editable append(CharSequence s) { text.append(s); return this; }
    @Override public Editable replace(int st, int en, CharSequence s) { text.replace(st, en, s.toString()); return this; }
    @Override public void clear() { text.setLength(0); }
    @Override public void setSpan(Object what, int start, int end, int flags) {}
    @Override public int length() { return text.length(); }
    @Override public char charAt(int i) { return text.charAt(i); }
    @Override public CharSequence subSequence(int start, int end) { return text.subSequence(start, end); }
    @Override public String toString() { return text.toString(); }
}
