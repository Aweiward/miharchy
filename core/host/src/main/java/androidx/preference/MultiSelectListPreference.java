package androidx.preference;

import java.util.HashSet;
import java.util.Set;

public class MultiSelectListPreference extends DialogPreference {
    private CharSequence[] entries = new CharSequence[0], entryValues = new CharSequence[0];
    private Set<String> values = new HashSet<>();

    public MultiSelectListPreference(android.content.Context context) {}
    public void setEntries(CharSequence[] entries) { this.entries = entries; }
    public CharSequence[] getEntries() { return entries; }
    public void setEntryValues(CharSequence[] values) { this.entryValues = values; }
    public CharSequence[] getEntryValues() { return entryValues; }
    public void setValues(Set<String> values) { this.values = values; }
    public Set<String> getValues() { return values; }
    public int findIndexOfValue(String v) {
        for (int i = 0; i < entryValues.length; i++) if (entryValues[i].toString().equals(v)) return i;
        return -1;
    }
}
