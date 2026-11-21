package android.widget;

public class EditText extends TextView {
    private int selStart, selEnd;
    public EditText() {}
    public EditText(android.content.Context context) { super(context); }
    @Override public void setText(CharSequence s) { super.setText(s); selStart = selEnd = length(); }
    public void selectAll() { selStart = 0; selEnd = length(); }
    public void setSelection(int index) { selStart = selEnd = Math.min(index, length()); }
    public void setSelection(int start, int stop) { selStart = Math.min(start, length()); selEnd = Math.min(stop, length()); }
    public int getSelectionStart() { return selStart; }
    public int getSelectionEnd() { return selEnd; }
}
