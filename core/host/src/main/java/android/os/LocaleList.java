package android.os;

import java.util.Locale;

public final class LocaleList {
    private static final LocaleList DEFAULT = new LocaleList();
    public static LocaleList getDefault() { return DEFAULT; }
    public int size() { return 1; }
    public Locale get(int index) { return Locale.getDefault(); }
}
