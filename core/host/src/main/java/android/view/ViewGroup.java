package android.view;

import android.content.Context;
import java.util.ArrayList;
import java.util.List;

public class ViewGroup extends View implements ViewParent {
    private final List<View> children = new ArrayList<>();
    private OnHierarchyChangeListener listener;

    public ViewGroup() { super(); }
    public ViewGroup(Context context) { super(context); }

    public void addView(View child) { addView(child, child.getLayoutParams()); }
    public void addView(View child, LayoutParams params) {
        if (child.parent instanceof ViewGroup g && g != this) g.removeView(child);
        if (params != null) child.setLayoutParams(params);
        child.parent = this;
        children.add(child);
        if (listener != null) listener.onChildViewAdded(this, child);
    }
    public void addView(View child, int width, int height) { addView(child, new LayoutParams(width, height)); }
    public void removeView(View child) {
        if (!children.remove(child)) return;
        child.parent = null;
        if (listener != null) listener.onChildViewRemoved(this, child);
    }
    public void removeAllViews() { for (View v : new ArrayList<>(children)) removeView(v); }
    public int getChildCount() { return children.size(); }
    public View getChildAt(int i) { return children.get(i); }
    public void setOnHierarchyChangeListener(OnHierarchyChangeListener l) { listener = l; }

    public interface OnHierarchyChangeListener {
        void onChildViewAdded(View parent, View child);
        void onChildViewRemoved(View parent, View child);
    }

    public static class LayoutParams {
        public static final int MATCH_PARENT = -1, FILL_PARENT = -1, WRAP_CONTENT = -2;
        public int width, height;
        public LayoutParams(int width, int height) { this.width = width; this.height = height; }
        public LayoutParams(LayoutParams source) { this(source.width, source.height); }
    }

    public static class MarginLayoutParams extends LayoutParams {
        public int leftMargin, topMargin, rightMargin, bottomMargin;
        public MarginLayoutParams(int width, int height) { super(width, height); }
        public void setMargins(int l, int t, int r, int b) { leftMargin = l; topMargin = t; rightMargin = r; bottomMargin = b; }
        public void setMarginStart(int start) { leftMargin = start; }
        public void setMarginEnd(int end) { rightMargin = end; }
        public int getMarginStart() { return leftMargin; }
        public int getMarginEnd() { return rightMargin; }
    }
}
