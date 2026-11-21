package android.app;

/** Reports a mid-range phone's memory, which extensions use only to size caches. */
public class ActivityManager {
    public void getMemoryInfo(MemoryInfo out) {
        out.totalMem = 8L << 30;
        out.availMem = 4L << 30;
        out.threshold = 256L << 20;
        out.lowMemory = false;
    }
    public boolean isLowRamDevice() { return false; }
    public int getMemoryClass() { return 512; }
    public static class MemoryInfo {
        public long availMem, totalMem, threshold;
        public boolean lowMemory;
    }
}
