package android.content;

public final class ComponentName {
    private final String pkg, cls;
    public ComponentName(String pkg, String cls) { this.pkg = pkg; this.cls = cls; }
    public ComponentName(Context context, String cls) { this(context == null ? "app.yomi" : context.getPackageName(), cls); }
    public ComponentName(Context context, Class<?> cls) { this(context, cls.getName()); }
    public String getPackageName() { return pkg; }
    public String getClassName() { return cls; }
}
