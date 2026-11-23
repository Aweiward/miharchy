package android.icu.text;

import java.text.CharacterIterator;

/** Finds the pattern in the target, comparing with the collator, one candidate length at a time. */
public final class StringSearch {
    public static final int DONE = -1;
    private String pattern, target = "";
    private final RuleBasedCollator collator;
    private boolean overlapping;
    private int pos, matchStart = DONE, matchLength;

    public StringSearch(String pattern, CharacterIterator target, RuleBasedCollator collator) {
        this.pattern = pattern;
        this.collator = collator;
        setTarget(target);
    }

    public void setPattern(String p) { pattern = p; reset(); }
    public void setTarget(CharacterIterator it) {
        StringBuilder b = new StringBuilder();
        for (char c = it.first(); c != CharacterIterator.DONE; c = it.next()) b.append(c);
        target = b.toString();
        reset();
    }
    public void setOverlapping(boolean allow) { overlapping = allow; }
    public void reset() { pos = 0; matchStart = DONE; matchLength = 0; }
    public int first() { reset(); return next(); }

    public int next() {
        for (int i = pos; i < target.length(); i++) {
            int max = Math.min(target.length(), i + pattern.length() * 2 + 2);
            for (int end = i + 1; end <= max; end++) {
                if (collator.base.equals(target.substring(i, end), pattern)) {
                    matchStart = i;
                    matchLength = end - i;
                    pos = overlapping ? i + 1 : end;
                    return i;
                }
            }
        }
        matchStart = DONE;
        return DONE;
    }

    public int getMatchStart() { return matchStart; }
    public int getMatchLength() { return matchLength; }
    public String getMatchedText() { return matchStart == DONE ? null : target.substring(matchStart, matchStart + matchLength); }
}
