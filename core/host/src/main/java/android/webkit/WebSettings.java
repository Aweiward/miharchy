package android.webkit;

/** The desktop WebView honours the user agent, JavaScript and image settings. The rest do nothing. */
public class WebSettings {
    public static final int LOAD_DEFAULT = -1, LOAD_NO_CACHE = 2, MIXED_CONTENT_ALWAYS_ALLOW = 0, MIXED_CONTENT_COMPATIBILITY_MODE = 2;
    private String userAgent = ENGINE_UA;
    private boolean js, dom, blockImages, wide, overview, multipleWindows, loadsImages = true;
    private int cacheMode = LOAD_DEFAULT;
    static final String DEFAULT_UA = "Mozilla/5.0 (Linux; Android 16; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36";

    // Pages see the WebKit browser they really run in. Claiming Chrome from WebKit fails Cloudflare's Turnstile.
    static final String ENGINE_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Safari/605.1.15";

    public static String getDefaultUserAgent(android.content.Context context) { return DEFAULT_UA; }

    public synchronized String getUserAgentString() { return userAgent; }
    public synchronized void setUserAgentString(String ua) { userAgent = ua == null || ua.isEmpty() ? ENGINE_UA : ua; }
    public synchronized boolean getJavaScriptEnabled() { return js; }
    public synchronized void setJavaScriptEnabled(boolean v) { js = v; }
    public synchronized boolean getDomStorageEnabled() { return dom; }
    public synchronized void setDomStorageEnabled(boolean v) { dom = v; }
    public synchronized boolean getBlockNetworkImage() { return blockImages; }
    public synchronized void setBlockNetworkImage(boolean v) { blockImages = v; }
    public synchronized boolean getLoadsImagesAutomatically() { return loadsImages; }
    public synchronized void setLoadsImagesAutomatically(boolean v) { loadsImages = v; }
    public synchronized boolean getUseWideViewPort() { return wide; }
    public synchronized void setUseWideViewPort(boolean v) { wide = v; }
    public synchronized boolean getLoadWithOverviewMode() { return overview; }
    public synchronized void setLoadWithOverviewMode(boolean v) { overview = v; }
    public synchronized void setSupportMultipleWindows(boolean v) { multipleWindows = v; }
    public synchronized boolean supportMultipleWindows() { return multipleWindows; }
    public synchronized int getCacheMode() { return cacheMode; }
    public synchronized void setCacheMode(int mode) { cacheMode = mode; }
    public void setDatabaseEnabled(boolean v) {}
    public void setMixedContentMode(int mode) {}
    public void setMediaPlaybackRequiresUserGesture(boolean v) {}
    public void setJavaScriptCanOpenWindowsAutomatically(boolean v) {}
    public void setAllowFileAccess(boolean v) {}
    public void setAllowContentAccess(boolean v) {}
    public void setBuiltInZoomControls(boolean v) {}
    public void setDisplayZoomControls(boolean v) {}
    public void setSupportZoom(boolean v) {}
    public void setTextZoom(int v) {}
    public void setGeolocationEnabled(boolean v) {}
    public void setOffscreenPreRaster(boolean v) {}
    /** Images are off when blocked by either switch. */
    synchronized boolean imagesBlocked() { return blockImages || !loadsImages; }
}
