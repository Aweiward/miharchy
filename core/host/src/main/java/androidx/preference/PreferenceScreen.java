package androidx.preference;

import java.util.ArrayList;
import java.util.List;

public class PreferenceScreen {
    private final android.content.Context context;
    private final List<Preference> preferences = new ArrayList<>();

    public PreferenceScreen() { this(new android.content.Context()); }
    public PreferenceScreen(android.content.Context context) { this.context = context; }

    public boolean addPreference(Preference preference) { return preferences.add(preference); }
    public android.content.Context getContext() { return context; }
    public List<Preference> hostPreferences() { return preferences; }
}
