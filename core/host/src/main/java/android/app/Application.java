package android.app;

import android.os.Bundle;

public class Application extends android.content.ContextWrapper {
    /** The desktop's one Activity, standing for the Nano window. */
    public static final Activity DESKTOP = new Activity();
    private static volatile Application current;

    public Application() { current = this; }

    /** What an Activity's getApplication() returns. */
    static Application current() { return current; }

    /** DESKTOP is resumed straight away and nothing else ever happens to it. */
    public void registerActivityLifecycleCallbacks(ActivityLifecycleCallbacks callback) {
        callback.onActivityResumed(DESKTOP);
    }
    public void unregisterActivityLifecycleCallbacks(ActivityLifecycleCallbacks callback) {}

    public interface ActivityLifecycleCallbacks {
        void onActivityCreated(Activity activity, Bundle savedInstanceState);
        void onActivityStarted(Activity activity);
        void onActivityResumed(Activity activity);
        void onActivityPaused(Activity activity);
        void onActivityStopped(Activity activity);
        void onActivitySaveInstanceState(Activity activity, Bundle outState);
        void onActivityDestroyed(Activity activity);
    }
}
