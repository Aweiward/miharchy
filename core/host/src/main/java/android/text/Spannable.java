package android.text;

public interface Spannable extends Spanned {
    void setSpan(Object what, int start, int end, int flags);
    default void removeSpan(Object what) {}
}
