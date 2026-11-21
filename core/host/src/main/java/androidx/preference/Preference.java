package androidx.preference;

/** Holds what an extension declares for one setting. The Rust app draws it. */
public class Preference {
    public interface OnPreferenceChangeListener { boolean onPreferenceChange(Preference preference, Object newValue); }
    public interface OnPreferenceClickListener { boolean onPreferenceClick(Preference preference); }

    private CharSequence title, summary;
    private String key;
    private Object defaultValue;
    private boolean enabled = true, visible = true;
    private OnPreferenceChangeListener changeListener;
    private OnPreferenceClickListener clickListener;

    public Preference() {}

    public void setOnPreferenceChangeListener(OnPreferenceChangeListener l) { changeListener = l; }
    public void setOnPreferenceClickListener(OnPreferenceClickListener l) { clickListener = l; }
    public OnPreferenceChangeListener hostChangeListener() { return changeListener; }
    public CharSequence getTitle() { return title; }
    public void setTitle(CharSequence title) { this.title = title; }
    public CharSequence getSummary() { return summary; }
    public void setSummary(CharSequence summary) { this.summary = summary; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public boolean hostEnabled() { return enabled; }
    public void setVisible(boolean visible) { this.visible = visible; }
    public boolean hostVisible() { return visible; }
    public String getKey() { return key; }
    public void setKey(String key) { this.key = key; }
    public void setDefaultValue(Object defaultValue) { this.defaultValue = defaultValue; }
    public Object hostDefaultValue() { return defaultValue; }
}
