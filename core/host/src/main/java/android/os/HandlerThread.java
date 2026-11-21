package android.os;

public class HandlerThread extends Thread {
    private Looper looper;

    public HandlerThread(String name) { super(name); setDaemon(true); }

    public HandlerThread(String name, int priority) { this(name); }

    @Override public void run() {
        Looper.prepare();
        synchronized (this) { looper = Looper.myLooper(); notifyAll(); }
        Looper.loop();
    }

    public Looper getLooper() {
        if (!isAlive()) return null;
        synchronized (this) {
            while (isAlive() && looper == null) try { wait(); } catch (InterruptedException ignored) {}
        }
        return looper;
    }

    public boolean quit() { Looper l = getLooper(); if (l == null) return false; l.quit(); return true; }

    public boolean quitSafely() { Looper l = getLooper(); if (l == null) return false; l.quitSafely(); return true; }
}
