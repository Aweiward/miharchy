package me.zhanghai.android.libarchive;

import java.nio.charset.StandardCharsets;
import java.util.zip.ZipEntry;

public final class ArchiveEntry {
    public static final int AE_IFMT = 0170000, AE_IFREG = 0100000, AE_IFDIR = 0040000;
    private ArchiveEntry() {}

    private static ZipEntry entry(long e) {
        if (!(Archive.HANDLES.get(e) instanceof ZipEntry z)) throw new IllegalStateException("no entry " + e);
        return z;
    }

    public static String pathnameUtf8(long entry) { return entry(entry).getName(); }
    public static byte[] pathname(long entry) { return entry(entry).getName().getBytes(StandardCharsets.UTF_8); }
    public static int filetype(long entry) { return entry(entry).isDirectory() ? AE_IFDIR : AE_IFREG; }
    public static long size(long entry) { return entry(entry).getSize(); }
}
