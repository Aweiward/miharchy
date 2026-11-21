package android.icu.text;

import java.text.CharacterIterator;
import java.util.Locale;

/** java.text.BreakIterator, with ICU's rule status worked out from the text between breaks. */
public abstract class BreakIterator {
    public static final int DONE = -1;
    public static final int WORD_NONE = 0, WORD_NUMBER = 100, WORD_LETTER = 200, WORD_KANA = 300, WORD_IDEO = 400;

    public abstract int first();
    public abstract int next();
    public abstract int current();
    public abstract void setText(CharacterIterator text);
    public void setText(String text) { setText(new java.text.StringCharacterIterator(text)); }
    public int getRuleStatus() { return WORD_NONE; }

    private static BreakIterator of(java.text.BreakIterator java, boolean words) {
        return new BreakIterator() {
            private String text = "";
            private int prev;
            @Override public int first() { prev = 0; return java.first(); }
            @Override public int next() { prev = java.current(); return java.next(); }
            @Override public int current() { return java.current(); }
            @Override public void setText(CharacterIterator it) {
                StringBuilder b = new StringBuilder();
                for (char c = it.first(); c != CharacterIterator.DONE; c = it.next()) b.append(c);
                text = b.toString();
                java.setText(text);
            }
            @Override public int getRuleStatus() {
                int end = java.current();
                if (!words || end <= prev || end > text.length()) return WORD_NONE;
                String s = text.substring(prev, end);
                int c = s.codePointAt(0);
                if (Character.isDigit(c)) return WORD_NUMBER;
                Character.UnicodeScript sc = Character.UnicodeScript.of(c);
                if (sc == Character.UnicodeScript.HIRAGANA || sc == Character.UnicodeScript.KATAKANA) return WORD_KANA;
                if (sc == Character.UnicodeScript.HAN) return WORD_IDEO;
                return Character.isLetter(c) ? WORD_LETTER : WORD_NONE;
            }
        };
    }

    public static BreakIterator getWordInstance() { return getWordInstance(Locale.getDefault()); }
    public static BreakIterator getWordInstance(Locale l) { return of(java.text.BreakIterator.getWordInstance(l), true); }
    public static BreakIterator getCharacterInstance() { return getCharacterInstance(Locale.getDefault()); }
    public static BreakIterator getCharacterInstance(Locale l) { return of(java.text.BreakIterator.getCharacterInstance(l), false); }
    public static BreakIterator getSentenceInstance() { return of(java.text.BreakIterator.getSentenceInstance(), false); }
    public static BreakIterator getLineInstance() { return of(java.text.BreakIterator.getLineInstance(), false); }
}
