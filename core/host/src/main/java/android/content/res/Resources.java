package android.content.res;

import android.util.DisplayMetrics;

public class Resources {
    private static final Resources SYSTEM = new Resources();
    private final DisplayMetrics metrics = new DisplayMetrics();
    private final Configuration configuration = new Configuration();

    public static Resources getSystem() { return SYSTEM; }
    public DisplayMetrics getDisplayMetrics() { return metrics; }
    public Configuration getConfiguration() { return configuration; }
}
