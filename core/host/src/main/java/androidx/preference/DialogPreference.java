package androidx.preference;

public abstract class DialogPreference extends Preference {
    private CharSequence dialogTitle, dialogMessage;
    public DialogPreference() {}
    public CharSequence getDialogTitle() { return dialogTitle; }
    public void setDialogTitle(CharSequence t) { dialogTitle = t; }
    public CharSequence getDialogMessage() { return dialogMessage; }
    public void setDialogMessage(CharSequence m) { dialogMessage = m; }
}
