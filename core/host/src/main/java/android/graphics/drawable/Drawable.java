package android.graphics.drawable;

/** Holds bounds. Nothing draws a Drawable on desktop unless code calls draw itself. */
public abstract class Drawable {
    private final android.graphics.Rect bounds = new android.graphics.Rect();
    public void draw(android.graphics.Canvas canvas) {}
    public void setBounds(int l, int t, int r, int b) { bounds.set(l, t, r, b); onBoundsChange(bounds); }
    public void setBounds(android.graphics.Rect r) { setBounds(r.left, r.top, r.right, r.bottom); }
    public final android.graphics.Rect getBounds() { return bounds; }
    protected void onBoundsChange(android.graphics.Rect bounds) {}
    public void invalidateSelf() {}
    public void setAlpha(int alpha) {}
    public void setColorFilter(android.graphics.ColorFilter filter) {}
    public int getOpacity() { return -3; }
    public int getIntrinsicWidth() { return -1; }
    public int getIntrinsicHeight() { return -1; }
}
