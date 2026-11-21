package android.hardware.display;

import android.view.Display;

public final class VirtualDisplay {
    private final Display display = new Display();
    public Display getDisplay() { return display; }
    public void release() {}
}
