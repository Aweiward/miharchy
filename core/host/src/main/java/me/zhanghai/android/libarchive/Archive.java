package me.zhanghai.android.libarchive;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Enumeration;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * libarchive's handle API over java.util.zip, so ZIP and CBZ archives open. RAR, 7z and the rest fail on open.
 * Handles are numbers into a table here, standing in for native pointers.
 */
public final class Archive {
    private Archive() {}

    static final ConcurrentHashMap<Long, Object> HANDLES = new ConcurrentHashMap<>();
    private static final AtomicLong NEXT = new AtomicLong(1);

    private static final class Reader {
        ZipFile zip;
        Enumeration<? extends ZipEntry> entries;
        ZipEntry current;
        long currentHandle;
    }

    static long put(Object o) { long h = NEXT.getAndIncrement(); HANDLES.put(h, o); return h; }

    private static Reader reader(long archive) {
        if (!(HANDLES.get(archive) instanceof Reader r)) throw new IllegalStateException("no archive " + archive);
        return r;
    }

    public static long readNew() { return put(new Reader()); }
    public static void readSupportFilterAll(long archive) {}
    public static void readSupportFormatAll(long archive) {}
    public static void setCharset(long archive, byte[] charset) {}

    public static void readOpenFileName(long archive, byte[] fileName, long blockSize) throws IOException {
        int n = fileName.length;
        while (n > 0 && fileName[n - 1] == 0) n--;
        Reader r = reader(archive);
        try {
            r.zip = new ZipFile(new File(new String(fileName, 0, n, StandardCharsets.UTF_8)));
        } catch (java.util.zip.ZipException e) {
            throw new IOException("Only ZIP and CBZ archives open in Nano", e);
        }
        r.entries = r.zip.entries();
    }

    /** The next entry's handle, or 0 at the end, as libarchive's EOF. */
    public static long readNextHeader(long archive) {
        Reader r = reader(archive);
        if (r.currentHandle != 0) HANDLES.remove(r.currentHandle);
        if (r.entries == null || !r.entries.hasMoreElements()) { r.current = null; r.currentHandle = 0; return 0; }
        r.current = r.entries.nextElement();
        r.currentHandle = put(r.current);
        return r.currentHandle;
    }

    /** Writes the current entry into the file behind a ParcelFileDescriptor's number. */
    public static void readDataIntoFd(long archive, int fd) throws IOException {
        Reader r = reader(archive);
        File out = android.os.ParcelFileDescriptor.fileOf(fd);
        if (out == null || r.current == null) throw new IOException("nothing to write to descriptor " + fd);
        try (InputStream in = r.zip.getInputStream(r.current); FileOutputStream o = new FileOutputStream(out)) {
            in.transferTo(o);
        }
    }

    public static void readFree(long archive) {
        if (HANDLES.remove(archive) instanceof Reader r) {
            if (r.currentHandle != 0) HANDLES.remove(r.currentHandle);
            try { if (r.zip != null) r.zip.close(); } catch (IOException ignored) {}
        }
    }
}
