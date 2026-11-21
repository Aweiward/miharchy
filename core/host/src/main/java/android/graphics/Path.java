package android.graphics;

import java.awt.geom.Path2D;

public class Path {
    final Path2D.Float shape = new Path2D.Float();
    public void moveTo(float x, float y) { shape.moveTo(x, y); }
    public void lineTo(float x, float y) { shape.lineTo(x, y); }
    public void quadTo(float x1, float y1, float x2, float y2) { shape.quadTo(x1, y1, x2, y2); }
    public void cubicTo(float x1, float y1, float x2, float y2, float x3, float y3) { shape.curveTo(x1, y1, x2, y2, x3, y3); }
    public void close() { shape.closePath(); }
    public void reset() { shape.reset(); }
}
