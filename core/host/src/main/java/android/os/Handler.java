package android.os;

/** Posts runnables to a {@link Looper}'s thread. No extension needs the message-based APIs yet. */
public class Handler {
    private final Looper looper;

    public Handler() {
        Looper l = Looper.myLooper();
        if (l == null) throw new RuntimeException("Can't create handler inside thread that has not called Looper.prepare()");
        looper = l;
    }

    public Handler(Looper looper) { this.looper = looper; }

    public final Looper getLooper() { return looper; }

    public final boolean post(Runnable r) { return postAtTime(r, SystemClock.uptimeMillis()); }

    public final boolean postDelayed(Runnable r, long delayMillis) { return postAtTime(r, SystemClock.uptimeMillis() + Math.max(0, delayMillis)); }

    public final boolean postDelayed(Runnable r, Object token, long delayMillis) { return postDelayed(r, delayMillis); }

    public final boolean postAtTime(Runnable r, long uptimeMillis) { return looper.enqueue(new Looper.Task(uptimeMillis, 0, r, this)); }

    public final boolean postAtFrontOfQueue(Runnable r) { return postAtTime(r, 0); }

    public final void removeCallbacks(Runnable r) { looper.remove(this, r); }

    public final void removeCallbacksAndMessages(Object token) { looper.remove(this, null); }

    public final boolean hasCallbacks(Runnable r) { return looper.has(this, r); }

    public static Handler createAsync(Looper looper) { return new Handler(looper); }
}
