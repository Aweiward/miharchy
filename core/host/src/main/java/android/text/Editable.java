package android.text;

/** Text a TextView holds and code may change in place. */
public interface Editable extends CharSequence, Spannable {
    Editable append(CharSequence text);
    Editable replace(int st, int en, CharSequence text);
    void clear();
}
