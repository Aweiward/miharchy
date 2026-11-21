package dalvik.system;

/** Android dex code can't run on the JVM. Classes still come from the parent; anything only in the dex fails to load. */
public class DexClassLoader extends ClassLoader {
    public DexClassLoader(String dexPath, String optimizedDirectory, String librarySearchPath, ClassLoader parent) { super(parent); }
    @Override protected Class<?> findClass(String name) throws ClassNotFoundException {
        throw new ClassNotFoundException(name + " (Android dex code can't run in Nano)");
    }
}
