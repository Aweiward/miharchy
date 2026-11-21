package android.graphics;

public class RectF {
    public float left, top, right, bottom;
    public RectF() {}
    public RectF(float left, float top, float right, float bottom) { set(left, top, right, bottom); }
    public RectF(Rect r) { this(r.left, r.top, r.right, r.bottom); }
    public RectF(RectF r) { this(r.left, r.top, r.right, r.bottom); }
    public void set(float l, float t, float r, float b) { left = l; top = t; right = r; bottom = b; }
    public void set(RectF r) { set(r.left, r.top, r.right, r.bottom); }
    public float width() { return right - left; }
    public float height() { return bottom - top; }
    public float centerX() { return (left + right) * 0.5f; }
    public float centerY() { return (top + bottom) * 0.5f; }
    public boolean isEmpty() { return left >= right || top >= bottom; }
}
