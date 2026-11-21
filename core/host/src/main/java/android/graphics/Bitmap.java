package android.graphics;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.Buffer;
import java.nio.ByteBuffer;
import java.nio.IntBuffer;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;

/** Pixels in an ARGB BufferedImage, so extensions can unscramble pages: decode, redraw tiles, encode. */
public final class Bitmap {
    public enum Config { ALPHA_8, RGB_565, ARGB_4444, ARGB_8888, RGBA_F16, HARDWARE }
    public enum CompressFormat { JPEG, PNG, WEBP, WEBP_LOSSY, WEBP_LOSSLESS }

    final BufferedImage image;
    private final Config config;

    Bitmap(BufferedImage image, Config config) {
        this.image = image;
        this.config = config == null ? Config.ARGB_8888 : config;
    }

    /** Any decoded image as ARGB, the only layout the rest of this class handles. */
    static Bitmap of(BufferedImage src) {
        if (src.getType() == BufferedImage.TYPE_INT_ARGB) return new Bitmap(src, Config.ARGB_8888);
        BufferedImage argb = new BufferedImage(src.getWidth(), src.getHeight(), BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = argb.createGraphics();
        g.drawImage(src, 0, 0, null);
        g.dispose();
        return new Bitmap(argb, Config.ARGB_8888);
    }

    public static Bitmap createBitmap(int width, int height, Config config) {
        return new Bitmap(new BufferedImage(Math.max(1, width), Math.max(1, height), BufferedImage.TYPE_INT_ARGB), config);
    }

    public static Bitmap createBitmap(Bitmap source, int x, int y, int width, int height) {
        Bitmap out = createBitmap(width, height, source.config);
        Graphics2D g = out.image.createGraphics();
        g.drawImage(source.image, 0, 0, width, height, x, y, x + width, y + height, null);
        g.dispose();
        return out;
    }

    public static Bitmap createBitmap(Bitmap source) { return createBitmap(source, 0, 0, source.getWidth(), source.getHeight()); }

    public static Bitmap createBitmap(int[] colors, int width, int height, Config config) {
        Bitmap out = createBitmap(width, height, config);
        out.image.setRGB(0, 0, width, height, colors, 0, width);
        return out;
    }

    public static Bitmap createScaledBitmap(Bitmap src, int width, int height, boolean filter) {
        Bitmap out = createBitmap(width, height, src.config);
        Graphics2D g = out.image.createGraphics();
        if (filter) g.setRenderingHint(java.awt.RenderingHints.KEY_INTERPOLATION, java.awt.RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.drawImage(src.image, 0, 0, width, height, null);
        g.dispose();
        return out;
    }

    public int getWidth() { return image.getWidth(); }
    public int getHeight() { return image.getHeight(); }
    public Config getConfig() { return config; }
    public boolean isMutable() { return true; }
    public boolean isRecycled() { return false; }
    public boolean hasAlpha() { return true; }
    public int getByteCount() { return getWidth() * getHeight() * 4; }
    public int getRowBytes() { return getWidth() * 4; }
    public void recycle() {}
    public Bitmap copy(Config config, boolean isMutable) { return createBitmap(this, 0, 0, getWidth(), getHeight()); }
    public int getPixel(int x, int y) { return image.getRGB(x, y); }
    public void setPixel(int x, int y, int color) { image.setRGB(x, y, color); }

    public void eraseColor(int color) {
        Graphics2D g = image.createGraphics();
        g.setComposite(java.awt.AlphaComposite.Src);
        g.setColor(new Color(color, true));
        g.fillRect(0, 0, getWidth(), getHeight());
        g.dispose();
    }

    public void getPixels(int[] pixels, int offset, int stride, int x, int y, int width, int height) {
        image.getRGB(x, y, width, height, pixels, offset, stride);
    }

    public void setPixels(int[] pixels, int offset, int stride, int x, int y, int width, int height) {
        image.setRGB(x, y, width, height, pixels, offset, stride);
    }

    /** ARGB_8888 in memory is R, G, B, A bytes, as on Android. */
    public void copyPixelsFromBuffer(Buffer src) {
        int w = getWidth(), n = w * getHeight();
        int[] px = new int[n];
        if (src instanceof ByteBuffer b) {
            for (int i = 0; i < n && b.remaining() >= 4; i++) {
                int r = b.get() & 0xff, g = b.get() & 0xff, bl = b.get() & 0xff, a = b.get() & 0xff;
                px[i] = a << 24 | r << 16 | g << 8 | bl;
            }
        } else if (src instanceof IntBuffer b) {
            // Read back as little-endian ints, the bytes R, G, B, A become 0xAABBGGRR.
            for (int i = 0; i < n && b.hasRemaining(); i++) {
                int v = b.get();
                px[i] = (v & 0xff00ff00) | (v & 0xff) << 16 | (v >> 16) & 0xff;
            }
        }
        image.setRGB(0, 0, w, getHeight(), px, 0, w);
    }

    public void copyPixelsToBuffer(Buffer dst) {
        int w = getWidth(), n = w * getHeight();
        int[] px = image.getRGB(0, 0, w, getHeight(), null, 0, w);
        if (dst instanceof ByteBuffer b) {
            for (int i = 0; i < n && b.remaining() >= 4; i++) {
                int v = px[i];
                b.put((byte) (v >> 16)).put((byte) (v >> 8)).put((byte) v).put((byte) (v >>> 24));
            }
        } else if (dst instanceof IntBuffer b) {
            for (int i = 0; i < n && b.hasRemaining(); i++) {
                int v = px[i];
                b.put((v & 0xff00ff00) | (v & 0xff) << 16 | (v >> 16) & 0xff);
            }
        }
    }

    /** JPEG honours quality. Java can't write WebP, so WebP requests get PNG, which Nano reads just the same. */
    public boolean compress(CompressFormat format, int quality, OutputStream stream) {
        try {
            if (format == CompressFormat.JPEG) {
                BufferedImage rgb = new BufferedImage(getWidth(), getHeight(), BufferedImage.TYPE_INT_RGB);
                Graphics2D g = rgb.createGraphics();
                g.setColor(Color.WHITE);
                g.fillRect(0, 0, getWidth(), getHeight());
                g.drawImage(image, 0, 0, null);
                g.dispose();
                ImageWriter writer = ImageIO.getImageWritersByFormatName("jpeg").next();
                ImageWriteParam param = writer.getDefaultWriteParam();
                param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
                param.setCompressionQuality(Math.max(0, Math.min(100, quality)) / 100f);
                try (var out = ImageIO.createImageOutputStream(stream)) {
                    writer.setOutput(out);
                    writer.write(null, new IIOImage(rgb, null, null), param);
                } finally {
                    writer.dispose();
                }
                return true;
            }
            return ImageIO.write(image, "png", stream);
        } catch (IOException e) {
            return false;
        }
    }
}
