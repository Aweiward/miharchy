package android.text;

public interface Spanned extends CharSequence {
    int SPAN_INCLUSIVE_EXCLUSIVE = 17, SPAN_INCLUSIVE_INCLUSIVE = 18, SPAN_EXCLUSIVE_EXCLUSIVE = 33, SPAN_EXCLUSIVE_INCLUSIVE = 34;
    default <T> T[] getSpans(int start, int end, Class<T> type) { @SuppressWarnings("unchecked") T[] none = (T[]) java.lang.reflect.Array.newInstance(type, 0); return none; }
    default int getSpanStart(Object span) { return -1; }
    default int getSpanEnd(Object span) { return -1; }
}
