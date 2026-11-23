package android.content;

import java.io.File;
import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Properties;
import java.util.Set;

/** SharedPreferences saved as a typed .properties file. Writes go through a temp file so a crash can't leave half a file. */
final class FilePreferences implements SharedPreferences {
    private static final char SEP = '\u001f';
    private final File file;
    private final Map<String, Object> values = new HashMap<>();

    FilePreferences(File file) {
        this.file = file;
        if (!file.exists()) return;
        Properties p = new Properties();
        try (Reader r = Files.newBufferedReader(file.toPath(), StandardCharsets.UTF_8)) {
            p.load(r);
        } catch (IOException e) {
            return;
        }
        for (String k : p.stringPropertyNames()) {
            String v = p.getProperty(k);
            if (v.length() < 2) continue;
            String raw = v.substring(2);
            try {
                switch (v.charAt(0)) {
                    case 's': values.put(k, raw); break;
                    case 'i': values.put(k, Integer.parseInt(raw)); break;
                    case 'l': values.put(k, Long.parseLong(raw)); break;
                    case 'f': values.put(k, Float.parseFloat(raw)); break;
                    case 'b': values.put(k, Boolean.parseBoolean(raw)); break;
                    case 'S': {
                        Set<String> set = new LinkedHashSet<>();
                        if (!raw.isEmpty()) for (String s : raw.split(String.valueOf(SEP), -1)) set.add(s);
                        values.put(k, set);
                        break;
                    }
                    default: break;
                }
            } catch (NumberFormatException ignored) {
                // skip a corrupt entry rather than losing the whole file
            }
        }
    }

    private synchronized Object get(String key) { return values.get(key); }

    public synchronized Map<String, ?> getAll() { return new HashMap<>(values); }
    public String getString(String k, String d) { return get(k) instanceof String s ? s : d; }
    @SuppressWarnings("unchecked")
    public Set<String> getStringSet(String k, Set<String> d) { return get(k) instanceof Set<?> s ? new LinkedHashSet<>((Set<String>) s) : d; }
    public int getInt(String k, int d) { return get(k) instanceof Integer i ? i : d; }
    public long getLong(String k, long d) { return get(k) instanceof Long l ? l : d; }
    public float getFloat(String k, float d) { return get(k) instanceof Float f ? f : d; }
    public boolean getBoolean(String k, boolean d) { return get(k) instanceof Boolean b ? b : d; }
    public synchronized boolean contains(String k) { return values.containsKey(k); }
    public Editor edit() { return new Ed(); }

    private synchronized void save() {
        Properties p = new Properties();
        values.forEach((k, v) -> {
            String enc;
            if (v instanceof String s) enc = "s:" + s;
            else if (v instanceof Integer) enc = "i:" + v;
            else if (v instanceof Long) enc = "l:" + v;
            else if (v instanceof Float) enc = "f:" + v;
            else if (v instanceof Boolean) enc = "b:" + v;
            else enc = "S:" + String.join(String.valueOf(SEP), (Set<String>) v);
            p.setProperty(k, enc);
        });
        try {
            File tmp = new File(file.getPath() + ".tmp");
            try (Writer w = Files.newBufferedWriter(tmp.toPath(), StandardCharsets.UTF_8)) {
                p.store(w, null);
            }
            Files.move(tmp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            System.err.println("prefs: failed to save " + file + ": " + e);
        }
    }

    private final class Ed implements Editor {
        private final Map<String, Object> puts = new HashMap<>();
        private final Set<String> removes = new LinkedHashSet<>();
        private boolean clear;

        public Editor putString(String k, String v) { puts.put(k, v); return this; }
        public Editor putStringSet(String k, Set<String> v) { puts.put(k, v == null ? null : new LinkedHashSet<>(v)); return this; }
        public Editor putInt(String k, int v) { puts.put(k, v); return this; }
        public Editor putLong(String k, long v) { puts.put(k, v); return this; }
        public Editor putFloat(String k, float v) { puts.put(k, v); return this; }
        public Editor putBoolean(String k, boolean v) { puts.put(k, v); return this; }
        public Editor remove(String k) { removes.add(k); return this; }
        public Editor clear() { clear = true; return this; }

        public boolean commit() {
            synchronized (FilePreferences.this) {
                if (clear) values.clear();
                removes.forEach(values::remove);
                puts.forEach((k, v) -> { if (v == null) values.remove(k); else values.put(k, v); });
                save();
            }
            return true;
        }

        public void apply() { commit(); }
    }
}
