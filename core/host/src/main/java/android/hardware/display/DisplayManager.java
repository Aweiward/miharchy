package android.hardware.display;

import android.view.Display;
import android.view.Surface;

public class DisplayManager {
    public static final int VIRTUAL_DISPLAY_FLAG_PUBLIC = 1, VIRTUAL_DISPLAY_FLAG_PRESENTATION = 2,
        VIRTUAL_DISPLAY_FLAG_SECURE = 4, VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY = 8;

    /** The WebView renders in the app's hidden window, so a virtual display is just a placeholder. */
    public VirtualDisplay createVirtualDisplay(String name, int width, int height, int densityDpi, Surface surface, int flags) {
        return new VirtualDisplay();
    }
}
