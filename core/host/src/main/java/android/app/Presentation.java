package android.app;

import android.content.Context;
import android.view.Display;

public class Presentation extends Dialog {
    private final Display display;
    public Presentation(Context outerContext, Display display) { super(outerContext); this.display = display; }
    public Presentation(Context outerContext, Display display, int theme) { this(outerContext, display); }
    public Display getDisplay() { return display; }
}
