package android.os;

import java.io.File;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/** Carries a file. getFd hands out a number that native-style APIs (libarchive) map back to it. */
public class ParcelFileDescriptor implements java.io.Closeable {
    public static final int MODE_READ_ONLY = 0x10000000, MODE_WRITE_ONLY = 0x20000000, MODE_READ_WRITE = 0x30000000;
    public static final int MODE_CREATE = 0x08000000, MODE_TRUNCATE = 0x04000000, MODE_APPEND = 0x02000000;
    private static final ConcurrentHashMap<Integer, ParcelFileDescriptor> OPEN = new ConcurrentHashMap<>();
    private static final AtomicInteger NEXT = new AtomicInteger(1000);
    private final File file;
    private int fd = -1;

    private ParcelFileDescriptor(File file) { this.file = file; }

    public static ParcelFileDescriptor open(File file, int mode) throws java.io.FileNotFoundException {
        if ((mode & MODE_CREATE) == 0 && (mode & MODE_WRITE_ONLY) == 0 && !file.exists()) throw new java.io.FileNotFoundException(file.getPath());
        return new ParcelFileDescriptor(file);
    }

    /** The descriptor's file, or null once closed. */
    public static File fileOf(int fd) { ParcelFileDescriptor p = OPEN.get(fd); return p == null ? null : p.file; }

    public File file() { return file; }

    public synchronized int getFd() {
        if (fd < 0) { fd = NEXT.getAndIncrement(); OPEN.put(fd, this); }
        return fd;
    }

    public int detachFd() { return getFd(); }

    @Override public synchronized void close() { if (fd >= 0) OPEN.remove(fd); }
}
