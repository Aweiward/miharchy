package android.os;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;

public class Bundle {
    private final Map<String, Object> map = new HashMap<>();
    public Bundle() {}
    public void put(String key, Object value) { map.put(key, value); }
    public Object get(String key) { return map.get(key); }
    public boolean containsKey(String key) { return map.containsKey(key); }
    public java.util.Set<String> keySet() { return map.keySet(); }
    public void putString(String key, String value) { map.put(key, value); }
    public String getString(String key) { return map.get(key) instanceof String s ? s : null; }
    public String getString(String key, String def) { String s = getString(key); return s == null ? def : s; }
    public void putInt(String key, int value) { map.put(key, value); }
    public int getInt(String key) { return getInt(key, 0); }
    public int getInt(String key, int def) { return map.get(key) instanceof Integer i ? i : def; }
    public void putLong(String key, long value) { map.put(key, value); }
    public long getLong(String key) { return getLong(key, 0); }
    public long getLong(String key, long def) { return map.get(key) instanceof Long l ? l : def; }
    public void putBoolean(String key, boolean value) { map.put(key, value); }
    public boolean getBoolean(String key) { return getBoolean(key, false); }
    public boolean getBoolean(String key, boolean def) { return map.get(key) instanceof Boolean b ? b : def; }
    public void putStringArrayList(String key, ArrayList<String> value) { map.put(key, value); }
    @SuppressWarnings("unchecked") public ArrayList<String> getStringArrayList(String key) { return (ArrayList<String>) map.get(key); }
    public void putParcelable(String key, Parcelable value) { map.put(key, value); }
    @SuppressWarnings("unchecked") public <T extends Parcelable> T getParcelable(String key) { return (T) map.get(key); }
}
