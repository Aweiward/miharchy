package app.cash.quickjs;

import java.nio.charset.StandardCharsets;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.ContextFactory;
import org.mozilla.javascript.NativeArray;
import org.mozilla.javascript.RhinoException;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.ScriptableObject;
import org.mozilla.javascript.Undefined;
import org.mozilla.javascript.Wrapper;

/**
 * QuickJS's API on Rhino, a JavaScript engine in plain Java. Results come back as QuickJS gives them:
 * String, Boolean, Integer for whole numbers, Double, Object[] for arrays, or null.
 */
public final class QuickJs implements java.io.Closeable {
    private static final ContextFactory FACTORY = new ContextFactory();
    private static final byte[] MAGIC = "nano-js:".getBytes(StandardCharsets.UTF_8);
    private final ScriptableObject scope;

    private QuickJs() {
        Context cx = enter();
        try { scope = cx.initStandardObjects(); } finally { Context.exit(); }
    }

    public static QuickJs create() { return new QuickJs(); }

    /** Interpreted, so Rhino needn't generate classes, and with ES6 syntax on. */
    private static Context enter() {
        Context cx = FACTORY.enterContext();
        cx.setOptimizationLevel(-1);
        cx.setLanguageVersion(Context.VERSION_ES6);
        return cx;
    }

    public Object evaluate(String script) { return evaluate(script, "?"); }

    public Object evaluate(String script, String fileName) {
        Context cx = enter();
        try {
            return toJava(cx.evaluateString(scope, script, fileName, 1, null));
        } catch (RhinoException e) {
            throw new QuickJsException(e.details(), e);
        } finally {
            Context.exit();
        }
    }

    /** There's no QuickJS bytecode here, so "compiled" code is the source, run again by execute. */
    public byte[] compile(String sourceCode, String fileName) {
        byte[] src = sourceCode.getBytes(StandardCharsets.UTF_8), out = new byte[MAGIC.length + src.length];
        System.arraycopy(MAGIC, 0, out, 0, MAGIC.length);
        System.arraycopy(src, 0, out, MAGIC.length, src.length);
        return out;
    }

    public Object execute(byte[] bytecode) {
        int skip = bytecode.length >= MAGIC.length && java.util.Arrays.equals(bytecode, 0, MAGIC.length, MAGIC, 0, MAGIC.length) ? MAGIC.length : 0;
        return evaluate(new String(bytecode, skip, bytecode.length - skip, StandardCharsets.UTF_8));
    }

    /** Exposes a Java object to scripts as a global. */
    public <T> void set(String name, Class<T> type, T object) {
        Context cx = enter();
        try { ScriptableObject.putProperty(scope, name, Context.javaToJS(object, scope)); } finally { Context.exit(); }
    }

    @Override public void close() {}

    static Object toJava(Object v) {
        if (v == null || v instanceof Undefined) return null;
        if (v instanceof Wrapper w) return w.unwrap();
        if (v instanceof CharSequence s) return s.toString();
        if (v instanceof Boolean) return v;
        if (v instanceof Number n) {
            double d = n.doubleValue();
            return d == Math.rint(d) && Math.abs(d) <= Integer.MAX_VALUE ? (Object) (int) d : (Object) d;
        }
        if (v instanceof NativeArray a) {
            Object[] out = new Object[(int) a.getLength()];
            for (int i = 0; i < out.length; i++) out[i] = toJava(a.get(i, a));
            return out;
        }
        if (v instanceof Scriptable) return Context.toString(v);
        return v;
    }
}
