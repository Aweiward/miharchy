package android.media;

import android.os.Handler;
import android.view.Surface;

/** Nothing renders into it on desktop, so no image ever shows up. */
public class ImageReader implements AutoCloseable {
    private final Surface surface = new Surface();
    public static ImageReader newInstance(int width, int height, int format, int maxImages) { return new ImageReader(); }
    public Surface getSurface() { return surface; }
    public void setOnImageAvailableListener(OnImageAvailableListener listener, Handler handler) {}
    public Image acquireLatestImage() { return null; }
    public Image acquireNextImage() { return null; }
    @Override public void close() {}

    public interface OnImageAvailableListener { void onImageAvailable(ImageReader reader); }
}
