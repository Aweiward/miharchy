package android.app;

import android.content.Context;
import android.content.DialogInterface;
import android.view.View;
import android.widget.Button;

/** Like Dialog, kept as state: nothing is shown, and a button only acts if code clicks it. */
public class AlertDialog extends Dialog {
    /** android.R.string.ok and cancel, which Android fixes at these ids. */
    private static final int OK = 0x0104000a, CANCEL = 0x01040000;
    private final Button positive, negative, neutral;
    private CharSequence title, message;

    public AlertDialog(Context context) {
        super(context);
        positive = new Button(context);
        negative = new Button(context);
        neutral = new Button(context);
    }

    public Button getButton(int which) {
        return switch (which) { case DialogInterface.BUTTON_POSITIVE -> positive; case DialogInterface.BUTTON_NEGATIVE -> negative; default -> neutral; };
    }

    public void setTitle(CharSequence t) { title = t; }
    public void setMessage(CharSequence m) { message = m; }
    public void setView(View view) { setContentView(view); }

    private void wire(int which, CharSequence label, DialogInterface.OnClickListener l) {
        Button b = getButton(which);
        b.setText(label);
        b.setOnClickListener(v -> { if (l != null) l.onClick(this, which); dismiss(); });
    }

    public static class Builder {
        private final AlertDialog dialog;
        private DialogInterface.OnDismissListener onDismiss;
        private DialogInterface.OnCancelListener onCancel;

        public Builder(Context context) { dialog = new AlertDialog(context); }
        public Builder(Context context, int themeResId) { this(context); }
        public Context getContext() { return dialog.getContext(); }
        public Builder setTitle(CharSequence title) { dialog.setTitle(title); return this; }
        public Builder setTitle(int resId) { return this; }
        public Builder setMessage(CharSequence message) { dialog.setMessage(message); return this; }
        public Builder setMessage(int resId) { return this; }
        public Builder setView(View view) { dialog.setView(view); return this; }
        public Builder setCancelable(boolean c) { return this; }
        public Builder setPositiveButton(CharSequence text, DialogInterface.OnClickListener l) { dialog.wire(DialogInterface.BUTTON_POSITIVE, text, l); return this; }
        public Builder setPositiveButton(int resId, DialogInterface.OnClickListener l) { return setPositiveButton(resId == OK ? "OK" : "", l); }
        public Builder setNegativeButton(CharSequence text, DialogInterface.OnClickListener l) { dialog.wire(DialogInterface.BUTTON_NEGATIVE, text, l); return this; }
        public Builder setNegativeButton(int resId, DialogInterface.OnClickListener l) { return setNegativeButton(resId == CANCEL ? "Cancel" : "", l); }
        public Builder setNeutralButton(CharSequence text, DialogInterface.OnClickListener l) { dialog.wire(DialogInterface.BUTTON_NEUTRAL, text, l); return this; }
        public Builder setOnDismissListener(DialogInterface.OnDismissListener l) { onDismiss = l; return this; }
        public Builder setOnCancelListener(DialogInterface.OnCancelListener l) { onCancel = l; return this; }
        public AlertDialog create() {
            if (onDismiss != null) dialog.setOnDismissListener(onDismiss);
            if (onCancel != null) dialog.setOnCancelListener(onCancel);
            return dialog;
        }
        public AlertDialog show() { AlertDialog d = create(); d.show(); return d; }
    }
}
