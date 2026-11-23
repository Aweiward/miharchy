package tachiyomi.decoder;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import java.io.InputStream;

/**
 * Mihon's native decoder, done with BitmapFactory: the formats ImageIO reads, not JPEG XL or AVIF.
 * The static $default methods are what Kotlin callers compile to when they skip default arguments.
 */
public final class ImageDecoder {
    public static final Companion Companion = new Companion();
    private Bitmap image;

    private ImageDecoder(Bitmap image) { this.image = image; }

    public int getWidth() { return image.getWidth(); }
    public int getHeight() { return image.getHeight(); }
    public void recycle() { image = null; }

    public Bitmap decode(Rect region, int sampleSize) {
        if (image == null) return null;
        Bitmap part = region == null || region.left == 0 && region.top == 0 && region.width() == getWidth() && region.height() == getHeight()
            ? image : Bitmap.createBitmap(image, region.left, region.top, region.width(), region.height());
        int s = Math.max(1, sampleSize);
        return s == 1 ? part : Bitmap.createScaledBitmap(part, Math.max(1, part.getWidth() / s), Math.max(1, part.getHeight() / s), true);
    }

    public static Bitmap decode$default(ImageDecoder d, Rect region, int sampleSize, int mask, Object unused) {
        if ((mask & 1) != 0) region = new Rect(0, 0, d.getWidth(), d.getHeight());
        if ((mask & 2) != 0) sampleSize = 1;
        return d.decode(region, sampleSize);
    }

    public static final class Companion {
        private Companion() {}

        public ImageDecoder newInstance(InputStream stream, boolean cropBorders, byte[] displayProfile) {
            Bitmap b = BitmapFactory.decodeStream(stream);
            return b == null ? null : new ImageDecoder(b);
        }

        public static ImageDecoder newInstance$default(Companion c, InputStream stream, boolean cropBorders, byte[] displayProfile, int mask, Object unused) {
            if ((mask & 2) != 0) cropBorders = false;
            if ((mask & 4) != 0) displayProfile = null;
            return c.newInstance(stream, cropBorders, displayProfile);
        }
    }
}
