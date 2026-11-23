package android.widget;

public class ImageView extends android.view.View {
    private android.graphics.drawable.Drawable drawable;
    private android.graphics.Bitmap bitmap;
    public ImageView(android.content.Context context) { super(context); }
    public void setImageDrawable(android.graphics.drawable.Drawable d) { drawable = d; }
    public android.graphics.drawable.Drawable getDrawable() { return drawable; }
    public void setImageBitmap(android.graphics.Bitmap b) { bitmap = b; }
    public void setImageResource(int resId) {}
    public void setScaleType(Object type) {}
    public void setAdjustViewBounds(boolean adjust) {}
}
