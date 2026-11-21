package android.content;

import android.net.Uri;

public class Intent {
    private String action;
    private Uri data;
    public Intent() {}
    public Intent setAction(String action) { this.action = action; return this; }
    public String getAction() { return action; }
    public Uri getData() { return data; }
    private final android.os.Bundle extras = new android.os.Bundle();
    private android.content.ComponentName component;
    private int flags;
    public Intent(String action) { this.action = action; }
    public Intent(String action, Uri data) { this.action = action; this.data = data; }
    public Intent(Context context, Class<?> cls) { component = new ComponentName(context, cls.getName()); }
    public Intent setData(Uri data) { this.data = data; return this; }
    public Intent putExtra(String name, String value) { extras.put(name, value); return this; }
    public Intent putExtra(String name, long value) { extras.put(name, value); return this; }
    public Intent putExtra(String name, int value) { extras.put(name, value); return this; }
    public Intent putExtra(String name, boolean value) { extras.put(name, value); return this; }
    public Intent putExtra(String name, android.os.Parcelable value) { extras.put(name, value); return this; }
    public String getStringExtra(String name) { return extras.getString(name); }
    public long getLongExtra(String name, long def) { return extras.getLong(name, def); }
    public int getIntExtra(String name, int def) { return extras.getInt(name, def); }
    public boolean getBooleanExtra(String name, boolean def) { return extras.getBoolean(name, def); }
    @SuppressWarnings("unchecked") public <T extends android.os.Parcelable> T getParcelableExtra(String name) { return (T) extras.get(name); }
    public android.os.Bundle getExtras() { return extras; }
    public Intent addFlags(int f) { flags |= f; return this; }
    public Intent setFlags(int f) { flags = f; return this; }
    public int getFlags() { return flags; }
    public Intent setComponent(android.content.ComponentName c) { component = c; return this; }
    public android.content.ComponentName getComponent() { return component; }
    public Intent setPackage(String pkg) { return this; }
    public static final int FLAG_ACTIVITY_NEW_TASK = 0x10000000, FLAG_ACTIVITY_CLEAR_TOP = 0x04000000;
}
