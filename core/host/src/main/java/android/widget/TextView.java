package android.widget;

import android.text.EditableText;

/** Holds text, hint and input settings for code that reads them back. Nothing is drawn. */
public class TextView extends android.view.View {
    private CharSequence error, hint;
    private final EditableText text = new EditableText("");
    private final java.util.List<android.text.TextWatcher> watchers = new java.util.ArrayList<>();
    private int inputType = 1, textColor = 0xff000000, maxLines = Integer.MAX_VALUE;
    private android.text.method.TransformationMethod transformation;
    public TextView() {}
    public TextView(android.content.Context context) { super(context); }
    public void addTextChangedListener(android.text.TextWatcher watcher) { watchers.add(watcher); }
    public void removeTextChangedListener(android.text.TextWatcher watcher) { watchers.remove(watcher); }
    public CharSequence getError() { return error; }
    public void setError(CharSequence error) { this.error = error; }
    public android.text.Editable getText() { return text; }
    public void setText(CharSequence s) {
        String before = text.toString(), after = s == null ? "" : s.toString();
        for (var w : watchers) w.beforeTextChanged(before, 0, before.length(), after.length());
        text.clear();
        text.append(after);
        for (var w : watchers) w.onTextChanged(after, 0, before.length(), after.length());
        for (var w : watchers) w.afterTextChanged(text);
    }
    public void setText(int resId) {}
    public void append(CharSequence s) { setText(text.toString() + s); }
    public int length() { return text.length(); }
    public void setHint(CharSequence hint) { this.hint = hint; }
    public void setHint(int resId) {}
    public CharSequence getHint() { return hint; }
    public void setInputType(int type) { inputType = type; }
    public int getInputType() { return inputType; }
    public void setSingleLine() { maxLines = 1; }
    public void setSingleLine(boolean single) { maxLines = single ? 1 : Integer.MAX_VALUE; }
    public void setMaxLines(int lines) { maxLines = lines; }
    public void setLines(int lines) { maxLines = lines; }
    public int getMaxLines() { return maxLines; }
    public void setHorizontallyScrolling(boolean whether) {}
    public void setTextColor(int color) { textColor = color; }
    public int getCurrentTextColor() { return textColor; }
    public void setTextSize(float size) {}
    public void setTextSize(int unit, float size) {}
    public void setGravity(int gravity) {}
    public void setTypeface(android.graphics.Typeface tf) {}
    public void setTransformationMethod(android.text.method.TransformationMethod m) { transformation = m; }
    public android.text.method.TransformationMethod getTransformationMethod() { return transformation; }
    public void setMovementMethod(android.text.method.MovementMethod m) {}
    public void setLinksClickable(boolean clickable) {}
    public void setTextIsSelectable(boolean selectable) {}
    public void setImeOptions(int options) {}
}
