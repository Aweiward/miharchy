package android.app;

import android.content.Context;
import android.content.DialogInterface;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.FrameLayout;

/** Dialogs aren't shown on desktop. This keeps their state so the code around them still runs. */
public class Dialog implements DialogInterface {
    private final Context context;
    private final Window window = new Window();
    private final FrameLayout content;
    private boolean showing;
    private OnCancelListener onCancel;
    private OnDismissListener onDismiss;

    public Dialog(Context context) { this(context, 0); }
    public Dialog(Context context, int themeResId) { this.context = context; content = new FrameLayout(context); }

    public Context getContext() { return context; }
    public Window getWindow() { return window; }
    public void setContentView(View view) { content.removeAllViews(); content.addView(view); }
    public void setContentView(View view, ViewGroup.LayoutParams params) { content.removeAllViews(); content.addView(view, params); }
    public void setCancelable(boolean flag) {}
    public void setCanceledOnTouchOutside(boolean cancel) {}
    public void setOnCancelListener(OnCancelListener l) { onCancel = l; }
    public void setOnDismissListener(OnDismissListener l) { onDismiss = l; }
    /** A dialog holding a WebView (a captcha to tap) is shown in the app's browser window. */
    public void show() {
        if (showing) return;
        showing = true;
        // A Presentation draws an extension's offscreen page, never anything for the user.
        if (this instanceof Presentation) return;
        android.webkit.WebView view = findWebView(content);
        if (view != null) yomi.host.WebViews.INSTANCE.present(view, this);
    }

    private static android.webkit.WebView findWebView(View v) {
        if (v instanceof android.webkit.WebView w) return w;
        if (v instanceof ViewGroup g) for (int i = 0; i < g.getChildCount(); i++) {
            android.webkit.WebView w = findWebView(g.getChildAt(i));
            if (w != null) return w;
        }
        return null;
    }
    public boolean isShowing() { return showing; }
    public void hide() { showing = false; }
    @Override public void cancel() { if (onCancel != null) onCancel.onCancel(this); dismiss(); }
    @Override public void dismiss() {
        if (!showing) return;
        showing = false;
        yomi.host.WebViews.INSTANCE.dismissed(this);
        if (onDismiss != null) onDismiss.onDismiss(this);
    }
}
