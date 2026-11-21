package androidx.preference;

public class EditTextPreference extends DialogPreference {
    public interface OnBindEditTextListener { void onBindEditText(android.widget.EditText editText); }

    private String text;
    private OnBindEditTextListener bindListener;

    public EditTextPreference(android.content.Context context) {}
    public String getText() { return text; }
    public void setText(String text) { this.text = text; }
    public void setOnBindEditTextListener(OnBindEditTextListener l) { bindListener = l; }
    OnBindEditTextListener getOnBindEditTextListener() { return bindListener; }
}
