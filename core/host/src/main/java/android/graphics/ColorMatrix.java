package android.graphics;

/** A 4x5 matrix over R, G, B, A in 0..255, row-major, as on Android. */
public class ColorMatrix {
    final float[] m = { 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0 };
    public ColorMatrix() {}
    public ColorMatrix(float[] src) { set(src); }
    public void set(float[] src) { System.arraycopy(src, 0, m, 0, 20); }
    public float[] getArray() { return m; }
    public void setSaturation(float sat) {
        float i = 1 - sat, r = 0.213f * i, g = 0.715f * i, b = 0.072f * i;
        set(new float[] { r + sat, g, b, 0, 0, r, g + sat, b, 0, 0, r, g, b + sat, 0, 0, 0, 0, 0, 1, 0 });
    }

    int apply(int argb) {
        float a = argb >>> 24, r = argb >> 16 & 0xff, g = argb >> 8 & 0xff, b = argb & 0xff;
        int nr = clamp(m[0] * r + m[1] * g + m[2] * b + m[3] * a + m[4]);
        int ng = clamp(m[5] * r + m[6] * g + m[7] * b + m[8] * a + m[9]);
        int nb = clamp(m[10] * r + m[11] * g + m[12] * b + m[13] * a + m[14]);
        int na = clamp(m[15] * r + m[16] * g + m[17] * b + m[18] * a + m[19]);
        return na << 24 | nr << 16 | ng << 8 | nb;
    }

    private static int clamp(float v) { return v < 0 ? 0 : v > 255 ? 255 : (int) v; }
}
