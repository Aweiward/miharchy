package android.view;

/** A touch, in device pixels of the pretend screen. */
public final class MotionEvent {
    public static final int ACTION_DOWN = 0, ACTION_UP = 1, ACTION_MOVE = 2, ACTION_CANCEL = 3;
    public static final int TOOL_TYPE_FINGER = 1;

    private final long downTime, eventTime;
    private final int action, source;
    private final float x, y;

    private MotionEvent(long downTime, long eventTime, int action, float x, float y, int source) {
        this.downTime = downTime; this.eventTime = eventTime; this.action = action; this.x = x; this.y = y; this.source = source;
    }

    public static MotionEvent obtain(long downTime, long eventTime, int action, int pointerCount,
                                     PointerProperties[] props, PointerCoords[] coords, int metaState, int buttonState,
                                     float xPrecision, float yPrecision, int deviceId, int edgeFlags, int source, int flags) {
        PointerCoords c = coords.length > 0 ? coords[0] : new PointerCoords();
        return new MotionEvent(downTime, eventTime, action, c.x, c.y, source);
    }

    public static MotionEvent obtain(long downTime, long eventTime, int action, float x, float y, int metaState) {
        return new MotionEvent(downTime, eventTime, action, x, y, InputDevice.SOURCE_TOUCHSCREEN);
    }

    public int getAction() { return action; }
    public int getActionMasked() { return action & 0xff; }
    public float getX() { return x; }
    public float getY() { return y; }
    public float getRawX() { return x; }
    public float getRawY() { return y; }
    public long getDownTime() { return downTime; }
    public long getEventTime() { return eventTime; }
    public int getSource() { return source; }
    public int getPointerCount() { return 1; }
    public void setSource(int source) {}
    public void recycle() {}

    public static final class PointerProperties {
        public int id, toolType;
        public PointerProperties() {}
    }

    public static final class PointerCoords {
        public float x, y, pressure, size, touchMajor, touchMinor, toolMajor, toolMinor, orientation;
        public PointerCoords() {}
    }
}
