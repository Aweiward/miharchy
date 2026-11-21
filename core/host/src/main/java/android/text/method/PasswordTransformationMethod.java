package android.text.method;

public class PasswordTransformationMethod implements TransformationMethod {
    private static final PasswordTransformationMethod INSTANCE = new PasswordTransformationMethod();
    public static PasswordTransformationMethod getInstance() { return INSTANCE; }
}
