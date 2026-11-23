package android.media;

public abstract class Image implements AutoCloseable {
    @Override public abstract void close();
    public int getWidth() { return 0; }
    public int getHeight() { return 0; }
    public int getFormat() { return 1; }
    public long getTimestamp() { return 0; }
    public Plane[] getPlanes() { return new Plane[0]; }
    public abstract static class Plane {
        public abstract java.nio.ByteBuffer getBuffer();
        public abstract int getPixelStride();
        public abstract int getRowStride();
    }
}
