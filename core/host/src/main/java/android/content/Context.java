package android.content;

import java.io.File;
import java.util.concurrent.ConcurrentHashMap;

/** Android's Context on desktop: a data folder, with SharedPreferences stored as files in it. */
public class Context {
    public static final int MODE_PRIVATE = 0;
    private static final ConcurrentHashMap<String, SharedPreferences> PREFS = new ConcurrentHashMap<>();
    private static volatile File dataDir = new File(System.getProperty("user.home"), ".yomi-host");

    public Context() {}

    /** The folder holds cookies and source settings, so only its owner may open it. */
    public static void setDataDir(File dir) {
        dir.mkdirs();
        try {
            java.nio.file.Files.setPosixFilePermissions(dir.toPath(), java.nio.file.attribute.PosixFilePermissions.fromString("rwx------"));
        } catch (UnsupportedOperationException e) {
            // Not a POSIX file system (Windows): the user's profile folder is private already.
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException("cannot make " + dir + " private", e);
        }
        dataDir = dir;
    }

    public File getFilesDir() { return mk(new File(dataDir, "files")); }
    public File getCacheDir() { return mk(new File(dataDir, "cache")); }
    public String getPackageName() { return "app.yomi"; }
    public Context getApplicationContext() { return this; }

    public SharedPreferences getSharedPreferences(String name, int mode) {
        return PREFS.computeIfAbsent(name, n -> new FilePreferences(new File(mk(new File(dataDir, "prefs")), safe(n) + ".properties")));
    }

    public void startActivity(Intent intent) {}

    public android.content.res.Resources getResources() { return android.content.res.Resources.getSystem(); }

    public android.os.Looper getMainLooper() { return android.os.Looper.getMainLooper(); }

    public static final String DISPLAY_SERVICE = "display";

    public Object getSystemService(String name) {
        if (ACTIVITY_SERVICE.equals(name)) return new android.app.ActivityManager();
        return DISPLAY_SERVICE.equals(name) ? new android.hardware.display.DisplayManager() : null;
    }

    public File getCodeCacheDir() { return mk(new File(dataDir, "code_cache")); }
    public File getExternalCacheDir() { return getCacheDir(); }
    public File getExternalFilesDir(String type) { return getFilesDir(); }
    public File getDir(String name, int mode) { return mk(new File(dataDir, "app_" + safe(name))); }
    public File getDataDir() { return dataDir; }
    public ClassLoader getClassLoader() { return Context.class.getClassLoader(); }
    public android.content.pm.ApplicationInfo getApplicationInfo() {
        var info = new android.content.pm.ApplicationInfo();
        info.dataDir = dataDir.getPath();
        info.packageName = getPackageName();
        return info;
    }
    public static final String ACTIVITY_SERVICE = "activity";
    @SuppressWarnings("unchecked")
    public <T> T getSystemService(Class<T> type) {
        if (type == android.app.ActivityManager.class) return (T) new android.app.ActivityManager();
        if (type == android.hardware.display.DisplayManager.class) return (T) new android.hardware.display.DisplayManager();
        return null;
    }
    private static File mk(File f) { f.mkdirs(); return f; }

    private static String safe(String n) { return n.replaceAll("[^A-Za-z0-9._-]", "_"); }
}
