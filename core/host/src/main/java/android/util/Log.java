package android.util;

/** Logs go to stderr because stdout carries the protocol. Set NANO_HOST_DEBUG to see info and debug lines. */
public final class Log {
    public static final int VERBOSE = 2, DEBUG = 3, INFO = 4, WARN = 5, ERROR = 6, ASSERT = 7;
    public static final String RULE = "─".repeat(60);
    private static final boolean DEBUG_ON = System.getenv("NANO_HOST_DEBUG") != null;

    public static int println(int priority, String tag, String msg) {
        if (priority < WARN && !DEBUG_ON) return 0;
        String level = switch (priority) { case VERBOSE -> "V"; case DEBUG -> "D"; case INFO -> "I"; case WARN -> "W"; case ERROR -> "E"; default -> "A"; };
        System.err.println(level + "/" + tag + ": " + msg);
        if (priority >= ERROR) System.err.println(RULE);
        return 0;
    }
    private static int log(int priority, String tag, String msg, Throwable tr) {
        return println(priority, tag, msg + (tr != null ? " " + tr : ""));
    }
    public static boolean isLoggable(String tag, int level) { return level >= WARN || DEBUG_ON; }
    public static String getStackTraceString(Throwable tr) {
        if (tr == null) return "";
        java.io.StringWriter sw = new java.io.StringWriter();
        tr.printStackTrace(new java.io.PrintWriter(sw));
        return sw.toString();
    }
    public static int v(String tag, String msg) { return log(VERBOSE, tag, msg, null); }
    public static int v(String tag, String msg, Throwable tr) { return log(VERBOSE, tag, msg, tr); }
    public static int d(String tag, String msg) { return log(DEBUG, tag, msg, null); }
    public static int d(String tag, String msg, Throwable tr) { return log(DEBUG, tag, msg, tr); }
    public static int i(String tag, String msg) { return log(INFO, tag, msg, null); }
    public static int i(String tag, String msg, Throwable tr) { return log(INFO, tag, msg, tr); }
    public static int w(String tag, String msg) { return log(WARN, tag, msg, null); }
    public static int w(String tag, String msg, Throwable tr) { return log(WARN, tag, msg, tr); }
    public static int w(String tag, Throwable tr) { return log(WARN, tag, "", tr); }
    public static int e(String tag, String msg) { return log(ERROR, tag, msg, null); }
    public static int e(String tag, String msg, Throwable tr) { return log(ERROR, tag, msg, tr); }
    public static int wtf(String tag, String msg) { return log(ASSERT, tag, msg, null); }
    public static int wtf(String tag, String msg, Throwable tr) { return log(ASSERT, tag, msg, tr); }
}
