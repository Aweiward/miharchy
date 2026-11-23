package android.text;

public abstract class Layout {
    public enum Alignment { ALIGN_NORMAL, ALIGN_OPPOSITE, ALIGN_CENTER }
    public static final int BREAK_STRATEGY_SIMPLE = 0, BREAK_STRATEGY_HIGH_QUALITY = 1, BREAK_STRATEGY_BALANCED = 2;
    public static final int HYPHENATION_FREQUENCY_NONE = 0, HYPHENATION_FREQUENCY_NORMAL = 1, HYPHENATION_FREQUENCY_FULL = 2;
    public abstract int getLineCount();
    public abstract int getHeight();
    public abstract int getWidth();
    public abstract void draw(android.graphics.Canvas canvas);
}
