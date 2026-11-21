package android.app;

import android.content.Intent;
import android.os.Bundle;

/** Extensions' Activities never start on desktop. One stand-in is always "resumed" so captcha dialogs have something to sit on. */
public class Activity extends android.content.ContextWrapper {
    public Activity() {}
    protected void onCreate(Bundle savedInstanceState) {}
    public Intent getIntent() { return new Intent(); }
    public void finish() {}
    protected void onDestroy() {}
    public boolean isChangingConfigurations() { return false; }
    protected void onStart() {}
    protected void onResume() {}
    protected void onPause() {}
    protected void onStop() {}
    public void setContentView(android.view.View view) {}
    /** Runs now on the main thread, or posts there from any other. */
    public final void runOnUiThread(Runnable action) {
        android.os.Looper main = android.os.Looper.getMainLooper();
        if (main.isCurrentThread()) action.run();
        else new android.os.Handler(main).post(action);
    }
    public boolean isFinishing() { return false; }
    public boolean isDestroyed() { return false; }
    public final Application getApplication() { return Application.current(); }
    public android.view.Window getWindow() { return new android.view.Window(); }
}
