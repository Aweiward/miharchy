package android.view;

public interface WindowManager {
    class LayoutParams extends ViewGroup.LayoutParams {
        public static final int FLAG_NOT_FOCUSABLE = 8, FLAG_NOT_TOUCHABLE = 16, FLAG_DIM_BEHIND = 2, FLAG_SECURE = 8192;
        public float alpha = 1, dimAmount = 1;
        public int flags, gravity, x, y, type, softInputMode;
        public LayoutParams() { super(MATCH_PARENT, MATCH_PARENT); }
        public LayoutParams(int type) { this(); this.type = type; }
    }
}
