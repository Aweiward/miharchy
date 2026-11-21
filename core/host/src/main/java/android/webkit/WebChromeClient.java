package android.webkit;

public class WebChromeClient {
    public boolean onConsoleMessage(ConsoleMessage consoleMessage) { return false; }
    public void onProgressChanged(WebView view, int newProgress) {}
    public void onReceivedTitle(WebView view, String title) {}
    public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) { return false; }
    public void onCloseWindow(WebView window) {}
}
