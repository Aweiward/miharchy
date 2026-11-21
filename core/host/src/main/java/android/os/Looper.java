package android.os;

import java.util.PriorityQueue;

/** A thread's message loop. The main one starts on first use, and Dispatchers.Main posts there too. */
public final class Looper {
    private static final ThreadLocal<Looper> CURRENT = new ThreadLocal<>();
    private static volatile Looper main;

    static final class Task implements Comparable<Task> {
        final long when; final long seq; final Runnable r; final Handler h;
        Task(long when, long seq, Runnable r, Handler h) { this.when = when; this.seq = seq; this.r = r; this.h = h; }
        public int compareTo(Task o) { return when != o.when ? Long.compare(when, o.when) : Long.compare(seq, o.seq); }
    }

    private final PriorityQueue<Task> queue = new PriorityQueue<>();
    private long seq;
    private boolean quitting;
    final Thread thread;

    private Looper() { thread = Thread.currentThread(); }

    public static void prepare() {
        if (CURRENT.get() != null) throw new RuntimeException("Only one Looper may be created per thread");
        CURRENT.set(new Looper());
    }

    public static Looper myLooper() { return CURRENT.get(); }

    public static synchronized Looper getMainLooper() {
        if (main == null) {
            Looper[] made = new Looper[1];
            Thread t = new Thread(() -> {
                prepare();
                synchronized (made) { made[0] = myLooper(); made.notifyAll(); }
                loop();
            }, "main");
            t.setDaemon(true);
            t.start();
            synchronized (made) {
                while (made[0] == null) try { made.wait(); } catch (InterruptedException e) { throw new RuntimeException(e); }
            }
            main = made[0];
        }
        return main;
    }

    public Thread getThread() { return thread; }

    public boolean isCurrentThread() { return Thread.currentThread() == thread; }

    synchronized boolean enqueue(Task t) {
        if (quitting) return false;
        queue.add(new Task(t.when, seq++, t.r, t.h));
        notifyAll();
        return true;
    }

    synchronized void remove(Handler h, Runnable r) {
        queue.removeIf(t -> t.h == h && (r == null || t.r == r));
    }

    synchronized boolean has(Handler h, Runnable r) {
        for (Task t : queue) if (t.h == h && t.r == r) return true;
        return false;
    }

    public static void loop() {
        Looper me = myLooper();
        if (me == null) throw new RuntimeException("No Looper; Looper.prepare() wasn't called on this thread.");
        while (true) {
            Task next;
            synchronized (me) {
                while (true) {
                    if (me.quitting && (me.queue.isEmpty() || me.quitNow)) return;
                    Task head = me.queue.peek();
                    long now = SystemClock.uptimeMillis();
                    if (head != null && head.when <= now) { next = me.queue.poll(); break; }
                    try { if (head == null) me.wait(); else me.wait(Math.max(1, head.when - now)); }
                    catch (InterruptedException e) { return; }
                }
            }
            try { next.r.run(); }
            catch (Throwable e) { System.err.println("Uncaught on looper " + me.thread.getName() + ": " + e); e.printStackTrace(); System.err.println(android.util.Log.RULE); }
        }
    }

    private boolean quitNow;

    public synchronized void quit() { quitting = true; quitNow = true; notifyAll(); }

    public synchronized void quitSafely() { quitting = true; notifyAll(); }
}
