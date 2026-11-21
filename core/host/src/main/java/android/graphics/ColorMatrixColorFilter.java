package android.graphics;

public class ColorMatrixColorFilter extends ColorFilter {
    final ColorMatrix matrix = new ColorMatrix();
    public ColorMatrixColorFilter(ColorMatrix matrix) { this.matrix.set(matrix.getArray()); }
    public ColorMatrixColorFilter(float[] array) { matrix.set(array); }
}
