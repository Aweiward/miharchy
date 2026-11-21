package android.graphics;

import java.awt.AlphaComposite;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.Shape;
import java.awt.geom.AffineTransform;
import java.awt.geom.Ellipse2D;
import java.awt.geom.Line2D;
import java.awt.geom.Rectangle2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.util.ArrayDeque;

/** Draws into a Bitmap through Graphics2D. save() and restore() keep the transform and clip. */
public class Canvas {
    private final Bitmap bitmap;
    private final Graphics2D g;
    private final ArrayDeque<Object[]> saved = new ArrayDeque<>();

    public Canvas(Bitmap bitmap) {
        this.bitmap = bitmap;
        g = bitmap.image.createGraphics();
    }

    public int getWidth() { return bitmap.getWidth(); }
    public int getHeight() { return bitmap.getHeight(); }

    public int save() { saved.push(new Object[] { g.getTransform(), g.getClip() }); return saved.size(); }
    public void restore() {
        if (saved.isEmpty()) return;
        Object[] s = saved.pop();
        g.setTransform((AffineTransform) s[0]);
        g.setClip((Shape) s[1]);
    }
    public int getSaveCount() { return saved.size() + 1; }
    public void restoreToCount(int count) { while (saved.size() >= count) restore(); }

    public void translate(float dx, float dy) { g.translate(dx, dy); }
    public void scale(float sx, float sy) { g.scale(sx, sy); }
    public void scale(float sx, float sy, float px, float py) { g.translate(px, py); g.scale(sx, sy); g.translate(-px, -py); }
    public void rotate(float degrees) { g.rotate(Math.toRadians(degrees)); }
    public void rotate(float degrees, float px, float py) { g.rotate(Math.toRadians(degrees), px, py); }
    public void concat(Matrix m) { if (m != null) g.transform(m.t); }
    public boolean clipRect(float l, float t, float r, float b) { g.clip(new Rectangle2D.Float(l, t, r - l, b - t)); return true; }
    public boolean clipRect(Rect r) { return clipRect(r.left, r.top, r.right, r.bottom); }
    public boolean clipRect(RectF r) { return clipRect(r.left, r.top, r.right, r.bottom); }

    public void drawColor(int color) {
        Graphics2D c = (Graphics2D) g.create();
        c.setTransform(new AffineTransform());
        c.setComposite(AlphaComposite.SrcOver);
        c.setColor(new Color(color, true));
        c.fillRect(0, 0, getWidth(), getHeight());
        c.dispose();
    }

    public void drawARGB(int a, int r, int gr, int b) { drawColor(a << 24 | r << 16 | gr << 8 | b); }
    public void drawRGB(int r, int gr, int b) { drawColor(0xff000000 | r << 16 | gr << 8 | b); }

    private Graphics2D painted(Paint p) {
        Graphics2D c = (Graphics2D) g.create();
        boolean aa = p == null || p.isAntiAlias();
        c.setRenderingHint(RenderingHints.KEY_ANTIALIASING, aa ? RenderingHints.VALUE_ANTIALIAS_ON : RenderingHints.VALUE_ANTIALIAS_OFF);
        c.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, aa ? RenderingHints.VALUE_TEXT_ANTIALIAS_ON : RenderingHints.VALUE_TEXT_ANTIALIAS_OFF);
        if (p != null && p.isFilterBitmap()) c.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        if (p != null) {
            c.setColor(new Color(p.getColor(), true));
            c.setStroke(p.stroke());
        }
        return c;
    }

    /** A paint's alpha fades a bitmap, and a colour matrix filter recolours it. */
    private BufferedImage source(Bitmap b, Paint p) {
        if (p == null || !(p.getColorFilter() instanceof ColorMatrixColorFilter f)) return b.image;
        int w = b.getWidth(), h = b.getHeight();
        int[] px = b.image.getRGB(0, 0, w, h, null, 0, w);
        for (int i = 0; i < px.length; i++) px[i] = f.matrix.apply(px[i]);
        BufferedImage out = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        out.setRGB(0, 0, w, h, px, 0, w);
        return out;
    }

    private Graphics2D forBitmap(Paint p) {
        Graphics2D c = painted(p);
        if (p != null && p.getAlpha() < 255) c.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_OVER, p.getAlpha() / 255f));
        return c;
    }

    public void drawBitmap(Bitmap b, float left, float top, Paint p) {
        Graphics2D c = forBitmap(p);
        c.drawImage(source(b, p), AffineTransform.getTranslateInstance(left, top), null);
        c.dispose();
    }

    public void drawBitmap(Bitmap b, Rect src, Rect dst, Paint p) {
        Rect s = src != null ? src : new Rect(0, 0, b.getWidth(), b.getHeight());
        Graphics2D c = forBitmap(p);
        c.drawImage(source(b, p), dst.left, dst.top, dst.right, dst.bottom, s.left, s.top, s.right, s.bottom, null);
        c.dispose();
    }

    public void drawBitmap(Bitmap b, Rect src, RectF dst, Paint p) {
        Rect s = src != null ? src : new Rect(0, 0, b.getWidth(), b.getHeight());
        Graphics2D c = forBitmap(p);
        c.translate(dst.left, dst.top);
        c.scale(dst.width() / Math.max(1, s.width()), dst.height() / Math.max(1, s.height()));
        c.drawImage(source(b, p), 0, 0, s.width(), s.height(), s.left, s.top, s.right, s.bottom, null);
        c.dispose();
    }

    public void drawBitmap(Bitmap b, Matrix m, Paint p) {
        Graphics2D c = forBitmap(p);
        c.drawImage(source(b, p), m == null ? new AffineTransform() : m.t, null);
        c.dispose();
    }

    private void shape(Shape s, Paint p) {
        Graphics2D c = painted(p);
        Paint.Style st = p == null ? Paint.Style.FILL : p.getStyle();
        if (st != Paint.Style.STROKE) c.fill(s);
        if (st != Paint.Style.FILL) c.draw(s);
        c.dispose();
    }

    public void drawRect(float l, float t, float r, float b, Paint p) { shape(new Rectangle2D.Float(l, t, r - l, b - t), p); }
    public void drawRect(Rect r, Paint p) { drawRect(r.left, r.top, r.right, r.bottom, p); }
    public void drawRect(RectF r, Paint p) { drawRect(r.left, r.top, r.right, r.bottom, p); }
    public void drawRoundRect(RectF r, float rx, float ry, Paint p) { shape(new RoundRectangle2D.Float(r.left, r.top, r.width(), r.height(), rx * 2, ry * 2), p); }
    public void drawRoundRect(float l, float t, float r, float b, float rx, float ry, Paint p) { drawRoundRect(new RectF(l, t, r, b), rx, ry, p); }
    public void drawCircle(float cx, float cy, float radius, Paint p) { shape(new Ellipse2D.Float(cx - radius, cy - radius, radius * 2, radius * 2), p); }
    public void drawOval(RectF r, Paint p) { shape(new Ellipse2D.Float(r.left, r.top, r.width(), r.height()), p); }
    public void drawPath(Path path, Paint p) { shape(path.shape, p); }
    public void drawLine(float x1, float y1, float x2, float y2, Paint p) {
        Graphics2D c = painted(p);
        c.draw(new Line2D.Float(x1, y1, x2, y2));
        c.dispose();
    }

    /** (x, y) is the baseline, shifted by the paint's alignment as on Android. */
    public void drawText(String text, float x, float y, Paint p) {
        if (text.isEmpty()) return;
        Graphics2D c = painted(p);
        c.setFont(p.font());
        float w = p.measureText(text);
        float dx = switch (p.getTextAlign()) { case CENTER -> -w / 2; case RIGHT -> -w; default -> 0; };
        var glyphs = p.font().createGlyphVector(c.getFontRenderContext(), text).getOutline(x + dx, y);
        Paint.Style st = p.getStyle();
        if (st != Paint.Style.STROKE) c.fill(glyphs);
        if (st != Paint.Style.FILL) c.draw(glyphs);
        c.dispose();
    }

    public void drawText(CharSequence text, int start, int end, float x, float y, Paint p) { drawText(text.subSequence(start, end).toString(), x, y, p); }
}
