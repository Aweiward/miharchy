package android.view;

public class Window {
    public void addFlags(int flags) {}
    public void clearFlags(int flags) {}
    public void setFlags(int flags, int mask) {}
    public void setBackgroundDrawable(android.graphics.drawable.Drawable drawable) {}
    public void setDimAmount(float amount) {}
    public void setLayout(int width, int height) {}
    public void setGravity(int gravity) {}
    private WindowManager.LayoutParams attributes = new WindowManager.LayoutParams();
    public WindowManager.LayoutParams getAttributes() { return attributes; }
    public void setAttributes(WindowManager.LayoutParams a) { attributes = a; }
    public void setSoftInputMode(int mode) {}
    public android.view.View getDecorView() { return new android.view.View(); }
}
