package android.graphics;

public final class Rect {
    public int left, top, right, bottom;
    public Rect() {}
    public Rect(int left, int top, int right, int bottom) { this.left = left; this.top = top; this.right = right; this.bottom = bottom; }
    public Rect(Rect r) { this(r.left, r.top, r.right, r.bottom); }
    public int width() { return right - left; }
    public int height() { return bottom - top; }
    public int centerX() { return (left + right) >> 1; }
    public int centerY() { return (top + bottom) >> 1; }
    public float exactCenterX() { return (left + right) * 0.5f; }
    public float exactCenterY() { return (top + bottom) * 0.5f; }
    public boolean isEmpty() { return left >= right || top >= bottom; }
    public void set(int l, int t, int r, int b) { left = l; top = t; right = r; bottom = b; }
    public void set(Rect r) { set(r.left, r.top, r.right, r.bottom); }
    public void offset(int dx, int dy) { left += dx; right += dx; top += dy; bottom += dy; }
    public boolean contains(int x, int y) { return x >= left && x < right && y >= top && y < bottom; }
    @Override public boolean equals(Object o) { return o instanceof Rect r && r.left == left && r.top == top && r.right == right && r.bottom == bottom; }
    @Override public int hashCode() { return ((left * 31 + top) * 31 + right) * 31 + bottom; }
    @Override public String toString() { return "Rect(" + left + ", " + top + " - " + right + ", " + bottom + ")"; }
}
