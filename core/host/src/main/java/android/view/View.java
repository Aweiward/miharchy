package android.view;

import android.content.Context;
import android.content.res.Resources;

/** Views are never drawn on desktop. They keep enough state (size, parent, layout params) to lay out a hidden WebView. */
public class View {
    public static final int VISIBLE = 0, INVISIBLE = 4, GONE = 8;

    protected final Context mContext;
    ViewParent parent;
    private ViewGroup.LayoutParams layoutParams;
    private int left, top, right, bottom, measuredWidth, measuredHeight, visibility;
    private float translationX, translationY;

    public View() { this(null); }
    public View(Context context) { mContext = context; }

    public Context getContext() { return mContext; }
    public Resources getResources() { return mContext != null ? mContext.getResources() : Resources.getSystem(); }
    public View findViewById(int id) { return null; }
    public View getRootView() { return this; }
    public void setEnabled(boolean enabled) {}
    public final ViewParent getParent() { return parent; }

    public void setLayoutParams(ViewGroup.LayoutParams params) { layoutParams = params; }
    public ViewGroup.LayoutParams getLayoutParams() { return layoutParams; }

    public final void measure(int widthMeasureSpec, int heightMeasureSpec) {
        measuredWidth = MeasureSpec.getSize(widthMeasureSpec);
        measuredHeight = MeasureSpec.getSize(heightMeasureSpec);
        onMeasure(widthMeasureSpec, heightMeasureSpec);
    }
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {}
    public final int getMeasuredWidth() { return measuredWidth; }
    public final int getMeasuredHeight() { return measuredHeight; }

    public void layout(int l, int t, int r, int b) {
        left = l; top = t; right = r; bottom = b;
        onSizeChanged(r - l, b - t);
    }
    protected void onSizeChanged(int width, int height) {}
    public final int getWidth() { return right - left; }
    public final int getHeight() { return bottom - top; }
    public final int getLeft() { return left; }
    public final int getTop() { return top; }

    public void setTranslationX(float x) { translationX = x; }
    public void setTranslationY(float y) { translationY = y; }
    public float getTranslationX() { return translationX; }
    public float getTranslationY() { return translationY; }
    public void setBackgroundColor(int color) {}
    public void setVisibility(int v) { visibility = v; }
    public int getVisibility() { return visibility; }
    public void setAlpha(float alpha) {}
    public void setFocusable(boolean focusable) {}
    public void setFocusableInTouchMode(boolean focusable) {}
    public boolean requestFocus() { return false; }
    public boolean isAttachedToWindow() { return false; }
    public void dispatchWindowVisibilityChanged(int visibility) {}
    public boolean dispatchTouchEvent(MotionEvent event) { return false; }
    public boolean onTouchEvent(MotionEvent event) { return false; }
    /** Never attached to a window, so posted runnables don't run. keiyoushi's WebView helpers expect that. */
    public boolean post(Runnable action) { return false; }
    public boolean postDelayed(Runnable action, long delayMillis) { return false; }
    public void invalidate() {}
    private int paddingLeft, paddingTop, paddingRight, paddingBottom;
    private CharSequence contentDescription;
    private OnClickListener onClick;
    public void setPadding(int l, int t, int r, int b) { paddingLeft = l; paddingTop = t; paddingRight = r; paddingBottom = b; }
    public void setPaddingRelative(int start, int t, int end, int b) { setPadding(start, t, end, b); }
    public int getPaddingLeft() { return paddingLeft; }
    public int getPaddingTop() { return paddingTop; }
    public int getPaddingRight() { return paddingRight; }
    public int getPaddingBottom() { return paddingBottom; }
    public int getPaddingStart() { return paddingLeft; }
    public int getPaddingEnd() { return paddingRight; }
    public void setContentDescription(CharSequence d) { contentDescription = d; }
    public CharSequence getContentDescription() { return contentDescription; }
    public void setImportantForAccessibility(int mode) {}
    public void setHorizontalScrollBarEnabled(boolean enabled) {}
    public void setVerticalScrollBarEnabled(boolean enabled) {}
    public void setId(int id) {}
    public void setMinimumHeight(int h) {}
    public void setMinimumWidth(int w) {}
    public void setOnClickListener(OnClickListener l) { onClick = l; }
    /** Nothing is tapped on desktop, but code may click a view itself. */
    public boolean performClick() { if (onClick == null) return false; onClick.onClick(this); return true; }
    public interface OnClickListener { void onClick(View v); }
    public void requestLayout() {}

    public static class MeasureSpec {
        public static final int UNSPECIFIED = 0, EXACTLY = 1 << 30, AT_MOST = 2 << 30;
        private static final int MODE_MASK = 3 << 30;
        public static int makeMeasureSpec(int size, int mode) { return (size & ~MODE_MASK) | (mode & MODE_MASK); }
        public static int getMode(int spec) { return spec & MODE_MASK; }
        public static int getSize(int spec) { return spec & ~MODE_MASK; }
    }
}
