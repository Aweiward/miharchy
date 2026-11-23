package android.graphics;

import java.awt.geom.AffineTransform;

/** post* applies after what's there, pre* before, as on Android. */
public class Matrix {
    final AffineTransform t = new AffineTransform();
    public void reset() { t.setToIdentity(); }
    public void setScale(float sx, float sy) { t.setToScale(sx, sy); }
    public void setTranslate(float dx, float dy) { t.setToTranslation(dx, dy); }
    public void setRotate(float degrees) { t.setToRotation(Math.toRadians(degrees)); }
    public boolean postTranslate(float dx, float dy) { t.preConcatenate(AffineTransform.getTranslateInstance(dx, dy)); return true; }
    public boolean postScale(float sx, float sy) { t.preConcatenate(AffineTransform.getScaleInstance(sx, sy)); return true; }
    public boolean postScale(float sx, float sy, float px, float py) {
        AffineTransform s = AffineTransform.getTranslateInstance(px, py);
        s.scale(sx, sy);
        s.translate(-px, -py);
        t.preConcatenate(s);
        return true;
    }
    public boolean postRotate(float degrees) { t.preConcatenate(AffineTransform.getRotateInstance(Math.toRadians(degrees))); return true; }
    public boolean postRotate(float degrees, float px, float py) { t.preConcatenate(AffineTransform.getRotateInstance(Math.toRadians(degrees), px, py)); return true; }
    public boolean preTranslate(float dx, float dy) { t.translate(dx, dy); return true; }
    public boolean preScale(float sx, float sy) { t.scale(sx, sy); return true; }
}
