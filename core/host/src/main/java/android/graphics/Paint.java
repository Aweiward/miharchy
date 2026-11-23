package android.graphics;

import java.awt.BasicStroke;
import java.awt.Font;
import java.awt.font.FontRenderContext;
import java.awt.font.TextAttribute;
import java.awt.geom.AffineTransform;
import java.util.Map;

/** Colour, stroke and text settings, turned into an AWT font and stroke when Canvas draws. */
public class Paint {
    public static final int ANTI_ALIAS_FLAG = 1, FILTER_BITMAP_FLAG = 2, DITHER_FLAG = 4;
    public enum Style { FILL, STROKE, FILL_AND_STROKE }
    public enum Join { MITER, ROUND, BEVEL }
    public enum Cap { BUTT, ROUND, SQUARE }
    public enum Align { LEFT, CENTER, RIGHT }

    public static class FontMetrics {
        public float top, ascent, descent, bottom, leading;
    }

    static final FontRenderContext FRC = new FontRenderContext(null, true, true);

    private int color = 0xff000000;
    private Style style = Style.FILL;
    private float strokeWidth, strokeMiter = 4, textSize = 12, textScaleX = 1, letterSpacing;
    private Cap cap = Cap.BUTT;
    private Join join = Join.MITER;
    private Align align = Align.LEFT;
    private Typeface typeface;
    private boolean antiAlias, filterBitmap;
    private ColorFilter colorFilter;

    public Paint() {}
    public Paint(int flags) { setFlags(flags); }
    public Paint(Paint p) { set(p); }

    public void set(Paint p) {
        color = p.color; style = p.style; strokeWidth = p.strokeWidth; strokeMiter = p.strokeMiter; textSize = p.textSize;
        textScaleX = p.textScaleX; letterSpacing = p.letterSpacing; cap = p.cap; join = p.join; align = p.align;
        typeface = p.typeface; antiAlias = p.antiAlias; filterBitmap = p.filterBitmap; colorFilter = p.colorFilter;
    }

    public void reset() { set(new Paint()); }
    public void setFlags(int flags) { antiAlias = (flags & ANTI_ALIAS_FLAG) != 0; filterBitmap = (flags & FILTER_BITMAP_FLAG) != 0; }
    public int getFlags() { return (antiAlias ? ANTI_ALIAS_FLAG : 0) | (filterBitmap ? FILTER_BITMAP_FLAG : 0); }
    public void setAntiAlias(boolean aa) { antiAlias = aa; }
    public boolean isAntiAlias() { return antiAlias; }
    public void setFilterBitmap(boolean filter) { filterBitmap = filter; }
    public boolean isFilterBitmap() { return filterBitmap; }
    public void setDither(boolean dither) {}
    public void setColor(int color) { this.color = color; }
    public int getColor() { return color; }
    public void setARGB(int a, int r, int g, int b) { color = a << 24 | r << 16 | g << 8 | b; }
    public void setAlpha(int a) { color = (color & 0x00ffffff) | (a & 0xff) << 24; }
    public int getAlpha() { return color >>> 24; }
    public void setStyle(Style style) { this.style = style; }
    public Style getStyle() { return style; }
    public void setStrokeWidth(float w) { strokeWidth = w; }
    public float getStrokeWidth() { return strokeWidth; }
    public void setStrokeMiter(float miter) { strokeMiter = Math.max(1, miter); }
    public void setStrokeCap(Cap cap) { this.cap = cap; }
    public void setStrokeJoin(Join join) { this.join = join; }
    public void setTextSize(float size) { textSize = size; }
    public float getTextSize() { return textSize; }
    public void setTextScaleX(float scaleX) { textScaleX = scaleX; }
    public float getTextScaleX() { return textScaleX; }
    public void setLetterSpacing(float spacing) { letterSpacing = spacing; }
    public float getLetterSpacing() { return letterSpacing; }
    public void setTextAlign(Align align) { this.align = align; }
    public Align getTextAlign() { return align; }
    public Typeface setTypeface(Typeface t) { typeface = t; return t; }
    public Typeface getTypeface() { return typeface; }
    public ColorFilter setColorFilter(ColorFilter filter) { colorFilter = filter; return filter; }
    public ColorFilter getColorFilter() { return colorFilter; }
    public void setFakeBoldText(boolean fake) {}
    public void setUnderlineText(boolean underline) {}
    public void setShadowLayer(float radius, float dx, float dy, int color) {}

    /** The AWT font for this size, scale and spacing. */
    Font font() {
        Font f = (typeface == null ? Typeface.DEFAULT : typeface).font.deriveFont(textSize);
        if (textScaleX != 1) f = f.deriveFont(AffineTransform.getScaleInstance(textScaleX, 1));
        if (letterSpacing != 0) f = f.deriveFont(Map.of(TextAttribute.TRACKING, letterSpacing));
        return f;
    }

    BasicStroke stroke() {
        int c = switch (cap) { case ROUND -> BasicStroke.CAP_ROUND; case SQUARE -> BasicStroke.CAP_SQUARE; default -> BasicStroke.CAP_BUTT; };
        int j = switch (join) { case ROUND -> BasicStroke.JOIN_ROUND; case BEVEL -> BasicStroke.JOIN_BEVEL; default -> BasicStroke.JOIN_MITER; };
        return new BasicStroke(Math.max(strokeWidth, 1), c, j, strokeMiter);
    }

    public float measureText(String text) { return text.isEmpty() ? 0 : (float) font().getStringBounds(text, FRC).getWidth(); }
    public float measureText(CharSequence text, int start, int end) { return measureText(text.subSequence(start, end).toString()); }
    public float measureText(char[] text, int index, int count) { return measureText(new String(text, index, count)); }

    public void getTextBounds(String text, int start, int end, Rect bounds) {
        var r = font().createGlyphVector(FRC, text.substring(start, end)).getVisualBounds();
        bounds.set((int) Math.floor(r.getMinX()), (int) Math.floor(r.getMinY()), (int) Math.ceil(r.getMaxX()), (int) Math.ceil(r.getMaxY()));
    }

    /** Android's ascent and top are negative, measured up from the baseline. */
    public FontMetrics getFontMetrics() {
        FontMetrics m = new FontMetrics();
        getFontMetrics(m);
        return m;
    }

    public float getFontMetrics(FontMetrics m) {
        var lm = font().getLineMetrics("Ag", FRC);
        m.ascent = -lm.getAscent();
        m.descent = lm.getDescent();
        m.leading = lm.getLeading();
        m.top = m.ascent * 1.1f;
        m.bottom = m.descent * 1.1f;
        return m.descent - m.ascent + m.leading;
    }

    public float getFontSpacing() { return getFontMetrics(new FontMetrics()); }
    public float ascent() { return getFontMetrics().ascent; }
    public float descent() { return getFontMetrics().descent; }
    public boolean hasGlyph(String s) { return font().canDisplayUpTo(s) == -1; }
}
