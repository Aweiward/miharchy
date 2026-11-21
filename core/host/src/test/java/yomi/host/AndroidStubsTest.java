package yomi.host;

import static org.junit.jupiter.api.Assertions.*;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Rect;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.text.Html;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import app.cash.quickjs.QuickJs;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Base64;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import me.zhanghai.android.libarchive.Archive;
import me.zhanghai.android.libarchive.ArchiveEntry;
import org.junit.jupiter.api.Test;

/** The Android classes extensions lean on hardest: image unscrambling, text pages, QuickJS, archives. */
class AndroidStubsTest {
    private static byte[] png(Bitmap b) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        assertTrue(b.compress(Bitmap.CompressFormat.PNG, 100, out));
        return out.toByteArray();
    }

    @Test void unscramblesTilesLikeExtensionsDo() {
        // Two tiles side by side, red then blue, decoded back from PNG like a downloaded page.
        Bitmap page = Bitmap.createBitmap(4, 2, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(page);
        c.drawColor(0xffff0000);
        android.graphics.Paint blue = new android.graphics.Paint();
        blue.setColor(0xff0000ff);
        c.drawRect(2, 0, 4, 2, blue);
        byte[] bytes = png(page);
        Bitmap decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        assertEquals(4, decoded.getWidth());

        Bitmap out = Bitmap.createBitmap(4, 2, Bitmap.Config.ARGB_8888);
        Canvas oc = new Canvas(out);
        oc.drawBitmap(decoded, new Rect(0, 0, 2, 2), new Rect(2, 0, 4, 2), null);
        oc.drawBitmap(decoded, new Rect(2, 0, 4, 2), new Rect(0, 0, 2, 2), null);
        assertEquals(0xff0000ff, out.getPixel(0, 0));
        assertEquals(0xffff0000, out.getPixel(3, 1));

        ByteArrayOutputStream jpeg = new ByteArrayOutputStream();
        assertTrue(out.compress(Bitmap.CompressFormat.JPEG, 90, jpeg));
        assertEquals(2, BitmapFactory.decodeByteArray(jpeg.toByteArray(), 0, jpeg.size()).getHeight());
        assertNull(BitmapFactory.decodeByteArray(new byte[] { 1, 2, 3 }, 0, 3), "not an image");
    }

    @Test void decodesWebp() {
        byte[] webp = Base64.getDecoder().decode("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA");
        Bitmap b = BitmapFactory.decodeByteArray(webp, 0, webp.length);
        assertNotNull(b, "WebP plugin registered");
        assertEquals(1, b.getWidth());
    }

    @Test void rgbaBuffersRoundTrip() {
        Bitmap b = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
        b.copyPixelsFromBuffer(ByteBuffer.wrap(new byte[] { 0x11, 0x22, 0x33, (byte) 0xff }));
        assertEquals(0xff112233, b.getPixel(0, 0));
        ByteBuffer back = ByteBuffer.allocate(4);
        b.copyPixelsToBuffer(back);
        assertArrayEquals(new byte[] { 0x11, 0x22, 0x33, (byte) 0xff }, back.array());
    }

    @Test void wrapsAndDrawsText() {
        TextPaint paint = new TextPaint();
        paint.setTextSize(20);
        paint.setColor(0xff000000);
        StaticLayout layout = StaticLayout.Builder.obtain("The quick brown fox jumps over the lazy dog\nagain", 0, 49, paint, 120)
            .setAlignment(Layout.Alignment.ALIGN_CENTER).build();
        assertTrue(layout.getLineCount() > 2, "wrapped: " + layout.getLineCount());
        Bitmap b = Bitmap.createBitmap(120, layout.getHeight() + 4, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        c.drawColor(0xffffffff);
        layout.draw(c);
        int dark = 0;
        for (int y = 0; y < b.getHeight(); y++) for (int x = 0; x < b.getWidth(); x++) if ((b.getPixel(x, y) & 0xff) < 128) dark++;
        assertTrue(dark > 50, "text drawn");
    }

    @Test void quickJsReturnsWhatQuickJsWould() {
        try (QuickJs js = QuickJs.create()) {
            assertEquals(2, js.evaluate("1 + 1"));
            assertEquals(2.5, js.evaluate("(() => 2.5)()"));
            assertEquals("ab", js.evaluate("let a = 'a'; a + `b`"));
            assertArrayEquals(new Object[] { 1, "x" }, (Object[]) js.evaluate("[1, 'x']"));
            assertEquals("{\"k\":[1]}", js.evaluate("JSON.stringify({k: [1]})"));
            assertNull(js.evaluate("undefined"));
            assertEquals(42, js.execute(js.compile("6 * 7", "x.js")));
            assertThrows(app.cash.quickjs.QuickJsException.class, () -> js.evaluate("nope("));
        }
    }

    @Test void htmlKeepsLineBreaks() {
        assertEquals("a\nb\nc", Html.fromHtml("<p>a</p><p>b<br>c</p>", Html.FROM_HTML_MODE_LEGACY).toString());
    }

    @Test void uriBuilderEncodes() {
        Uri u = Uri.parse("https://x.com/a?q=1").buildUpon().appendPath("b c").appendQueryParameter("k", "v w").build();
        assertEquals("https://x.com/a/b%20c?q=1&k=v%20w", u.toString());
    }

    @Test void readsCbzThroughLibarchive() throws Exception {
        File dir = Files.createTempDirectory("arc").toFile();
        File cbz = new File(dir, "a.cbz"), page = new File(dir, "p1");
        try (ZipOutputStream z = new ZipOutputStream(new FileOutputStream(cbz))) {
            z.putNextEntry(new ZipEntry("001.jpg"));
            z.write("page".getBytes(StandardCharsets.UTF_8));
        }
        long a = Archive.readNew();
        Archive.readSupportFormatAll(a);
        Archive.readOpenFileName(a, (cbz.getPath() + "\0").getBytes(StandardCharsets.UTF_8), 10240);
        long e = Archive.readNextHeader(a);
        assertEquals("001.jpg", ArchiveEntry.pathnameUtf8(e));
        assertEquals(ArchiveEntry.AE_IFREG, ArchiveEntry.filetype(e));
        try (ParcelFileDescriptor fd = ParcelFileDescriptor.open(page, ParcelFileDescriptor.MODE_WRITE_ONLY | ParcelFileDescriptor.MODE_CREATE)) {
            Archive.readDataIntoFd(a, fd.getFd());
        }
        assertEquals("page", Files.readString(page.toPath()));
        assertEquals(0, Archive.readNextHeader(a), "end of archive");
        Archive.readFree(a);
    }
}
