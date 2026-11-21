package android.graphics.pdf;

/** Rendering PDF pages needs a PDF engine the host doesn't ship, so opening one says so. */
public final class PdfRenderer implements AutoCloseable {
    public PdfRenderer(android.os.ParcelFileDescriptor input) throws java.io.IOException {
        throw new java.io.IOException("PDF pages aren't supported in Nano yet");
    }
    public int getPageCount() { return 0; }
    public Page openPage(int index) { throw new IllegalStateException("no PDF open"); }
    @Override public void close() {}
    public final class Page implements AutoCloseable {
        public static final int RENDER_MODE_FOR_DISPLAY = 1, RENDER_MODE_FOR_PRINT = 2;
        private Page() {}
        public int getWidth() { return 0; }
        public int getHeight() { return 0; }
        public void render(android.graphics.Bitmap destination, android.graphics.Rect destClip, android.graphics.Matrix transform, int renderMode) {}
        @Override public void close() {}
    }
}
