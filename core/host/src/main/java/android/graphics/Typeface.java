package android.graphics;

import java.awt.Font;
import java.io.File;

/** A java.awt.Font family and style. Paint sizes it. */
public class Typeface {
    public static final int NORMAL = 0, BOLD = 1, ITALIC = 2, BOLD_ITALIC = 3;
    public static final Typeface DEFAULT = new Typeface(new Font(Font.SANS_SERIF, Font.PLAIN, 1), NORMAL);
    public static final Typeface DEFAULT_BOLD = new Typeface(new Font(Font.SANS_SERIF, Font.BOLD, 1), BOLD);
    public static final Typeface SANS_SERIF = DEFAULT;
    public static final Typeface SERIF = new Typeface(new Font(Font.SERIF, Font.PLAIN, 1), NORMAL);
    public static final Typeface MONOSPACE = new Typeface(new Font(Font.MONOSPACED, Font.PLAIN, 1), NORMAL);

    final Font font;
    private final int style;

    private Typeface(Font font, int style) { this.font = font; this.style = style; }

    public int getStyle() { return style; }
    public boolean isBold() { return (style & BOLD) != 0; }
    public boolean isItalic() { return (style & ITALIC) != 0; }

    private static int awt(int style) { return ((style & BOLD) != 0 ? Font.BOLD : 0) | ((style & ITALIC) != 0 ? Font.ITALIC : 0); }

    public static Typeface create(Typeface family, int style) {
        Font base = family == null ? DEFAULT.font : family.font;
        return new Typeface(base.deriveFont(awt(style)), style);
    }

    public static Typeface create(String familyName, int style) {
        String name = familyName == null ? Font.SANS_SERIF : switch (familyName) {
            case "serif" -> Font.SERIF;
            case "monospace" -> Font.MONOSPACED;
            case "sans-serif" -> Font.SANS_SERIF;
            default -> familyName;
        };
        return new Typeface(new Font(name, awt(style), 1), style);
    }

    public static Typeface defaultFromStyle(int style) { return create(DEFAULT, style); }

    /** Falls back to the default face if the file isn't a font Java can read. */
    public static Typeface createFromFile(File file) {
        try {
            return new Typeface(Font.createFont(Font.TRUETYPE_FONT, file), NORMAL);
        } catch (Exception e) {
            return DEFAULT;
        }
    }

    public static Typeface createFromFile(String path) { return createFromFile(new File(path)); }
}
