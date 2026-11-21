package android.graphics;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;

/** Decodes with ImageIO: JPEG, PNG, GIF and BMP, plus WebP through the TwelveMonkeys plugin. Null when it can't, as on Android. */
public class BitmapFactory {
    public static class Options {
        public boolean inJustDecodeBounds;
        public boolean inMutable;
        public boolean inScaled = true;
        public int inSampleSize = 1;
        public Bitmap.Config inPreferredConfig = Bitmap.Config.ARGB_8888;
        public int outWidth = -1, outHeight = -1;
        public String outMimeType;
    }

    public static Bitmap decodeByteArray(byte[] data, int offset, int length) { return decodeByteArray(data, offset, length, null); }

    public static Bitmap decodeByteArray(byte[] data, int offset, int length, Options opts) {
        return decodeStream(new ByteArrayInputStream(data, offset, length), null, opts);
    }

    public static Bitmap decodeStream(InputStream is) { return decodeStream(is, null, null); }

    public static Bitmap decodeStream(InputStream is, Rect outPadding, Options opts) {
        try (ImageInputStream in = ImageIO.createImageInputStream(is)) {
            if (in == null) return null;
            var readers = ImageIO.getImageReaders(in);
            if (!readers.hasNext()) return null;
            ImageReader reader = readers.next();
            try {
                reader.setInput(in, true, true);
                if (opts != null) {
                    opts.outWidth = reader.getWidth(0);
                    opts.outHeight = reader.getHeight(0);
                    opts.outMimeType = "image/" + reader.getFormatName().toLowerCase();
                    if (opts.inJustDecodeBounds) return null;
                }
                var param = reader.getDefaultReadParam();
                int sample = opts == null ? 1 : Math.max(1, opts.inSampleSize);
                if (sample > 1) param.setSourceSubsampling(sample, sample, 0, 0);
                return Bitmap.of(reader.read(0, param));
            } finally {
                reader.dispose();
            }
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    public static Bitmap decodeFile(String pathName) { return decodeFile(pathName, null); }

    public static Bitmap decodeFile(String pathName, Options opts) {
        try (InputStream in = new java.io.FileInputStream(pathName)) {
            return decodeStream(in, null, opts);
        } catch (IOException e) {
            return null;
        }
    }
}
