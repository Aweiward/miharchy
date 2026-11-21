package ca.mpreg.imagedecoder;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import java.io.InputStream;
import java.nio.ByteBuffer;

/** One frame per image, as RGBA bytes, decoded with BitmapFactory. Never HDR. */
public final class ImageDecoder implements AutoCloseable {
    public static final Companion Companion = new Companion();
    private Bitmap image;

    private ImageDecoder(Bitmap image) { this.image = image; }

    public boolean isHdr() { return false; }

    /** The image once, then null. */
    public Frame decodeNext() {
        if (image == null) return null;
        Bitmap b = image;
        image = null;
        ByteBuffer pixels = ByteBuffer.allocate(b.getWidth() * b.getHeight() * 4);
        b.copyPixelsToBuffer(pixels);
        pixels.flip();
        return new Frame(b.getWidth(), b.getHeight(), pixels);
    }

    @Override public void close() { image = null; }

    public static final class Frame {
        private final int width, height;
        private final ByteBuffer image;
        Frame(int width, int height, ByteBuffer image) { this.width = width; this.height = height; this.image = image; }
        public int getWidth() { return width; }
        public int getHeight() { return height; }
        public ByteBuffer getImage() { return image; }
    }

    public static final class Companion {
        private Companion() {}

        public ImageDecoder open(InputStream stream, boolean cropBorders) {
            Bitmap b = BitmapFactory.decodeStream(stream);
            return b == null ? null : new ImageDecoder(b);
        }

        public static ImageDecoder open$default(Companion c, InputStream stream, boolean cropBorders, int mask, Object unused) {
            if ((mask & 2) != 0) cropBorders = false;
            return c.open(stream, cropBorders);
        }
    }
}
