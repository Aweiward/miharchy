package android.text;

import android.graphics.Canvas;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Text wrapped to a width, for extensions that draw text pages. Lines break where Java's line BreakIterator
 * allows, which covers spaces and CJK; a word wider than the line is split by character. Spans aren't drawn.
 */
public class StaticLayout extends Layout {
    private final TextPaint paint;
    private final int width;
    private final Alignment align;
    private final float lineHeight;
    private final List<String> lines = new ArrayList<>();

    public StaticLayout(CharSequence source, TextPaint paint, int width, Alignment align, float spacingMult, float spacingAdd, boolean includePad) {
        this(source, 0, source.length(), paint, width, align, spacingMult, spacingAdd, includePad);
    }

    public StaticLayout(CharSequence source, int start, int end, TextPaint paint, int width, Alignment align, float spacingMult, float spacingAdd, boolean includePad) {
        this.paint = paint;
        this.width = width;
        this.align = align == null ? Alignment.ALIGN_NORMAL : align;
        lineHeight = paint.getFontSpacing() * spacingMult + spacingAdd;
        for (String para : source.subSequence(start, end).toString().split("\n", -1)) wrap(para);
    }

    private void wrap(String para) {
        if (para.isEmpty()) { lines.add(""); return; }
        var breaks = java.text.BreakIterator.getLineInstance(Locale.ROOT);
        breaks.setText(para);
        StringBuilder line = new StringBuilder();
        int from = breaks.first();
        for (int to = breaks.next(); to != java.text.BreakIterator.DONE; from = to, to = breaks.next()) {
            String word = para.substring(from, to);
            if (paint.measureText(line + word.stripTrailing()) <= width || line.length() == 0 && paint.measureText(word.stripTrailing()) <= width) {
                line.append(word);
                continue;
            }
            if (line.length() > 0) { lines.add(line.toString().stripTrailing()); line.setLength(0); }
            // A word on its own still too wide goes character by character.
            for (int i = 0; i < word.length(); i++) {
                if (line.length() > 0 && paint.measureText(line.toString() + word.charAt(i)) > width) { lines.add(line.toString()); line.setLength(0); }
                line.append(word.charAt(i));
            }
        }
        lines.add(line.toString().stripTrailing());
    }

    @Override public int getLineCount() { return lines.size(); }
    @Override public int getHeight() { return (int) Math.ceil(lines.size() * lineHeight); }
    @Override public int getWidth() { return width; }
    public int getLineTop(int line) { return (int) (line * lineHeight); }
    public int getLineBottom(int line) { return (int) ((line + 1) * lineHeight); }
    public float getLineWidth(int line) { return paint.measureText(lines.get(line)); }
    public CharSequence getText() { return String.join("\n", lines); }

    /** Lines start at (0, 0) in the canvas's current transform, as on Android. */
    @Override public void draw(Canvas canvas) {
        float ascent = -paint.getFontMetrics().ascent;
        var saved = paint.getTextAlign();
        paint.setTextAlign(android.graphics.Paint.Align.LEFT);
        for (int i = 0; i < lines.size(); i++) {
            String s = lines.get(i);
            float w = paint.measureText(s);
            float x = switch (align) { case ALIGN_CENTER -> (width - w) / 2; case ALIGN_OPPOSITE -> width - w; default -> 0; };
            canvas.drawText(s, x, i * lineHeight + ascent, paint);
        }
        paint.setTextAlign(saved);
    }

    public static final class Builder {
        private final CharSequence text;
        private final int start, end, width;
        private final TextPaint paint;
        private Alignment align = Alignment.ALIGN_NORMAL;
        private float mult = 1, add;
        private boolean includePad = true;

        private Builder(CharSequence text, int start, int end, TextPaint paint, int width) {
            this.text = text; this.start = start; this.end = end; this.paint = paint; this.width = width;
        }

        public static Builder obtain(CharSequence text, int start, int end, TextPaint paint, int width) { return new Builder(text, start, end, paint, width); }
        public Builder setAlignment(Alignment a) { align = a; return this; }
        public Builder setLineSpacing(float spacingAdd, float spacingMult) { add = spacingAdd; mult = spacingMult; return this; }
        public Builder setIncludePad(boolean pad) { includePad = pad; return this; }
        public Builder setBreakStrategy(int strategy) { return this; }
        public Builder setHyphenationFrequency(int frequency) { return this; }
        public Builder setMaxLines(int max) { return this; }
        public Builder setEllipsize(Object where) { return this; }
        public Builder setTextDirection(Object dir) { return this; }
        public StaticLayout build() { return new StaticLayout(text, start, end, paint, width, align, mult, add, includePad); }
    }
}
