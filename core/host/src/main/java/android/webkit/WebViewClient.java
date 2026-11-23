package android.webkit;

import android.graphics.Bitmap;

public class WebViewClient {
    public void onPageStarted(WebView view, String url, Bitmap favicon) {}
    public void onPageFinished(WebView view, String url) {}
    public void onLoadResource(WebView view, String url) {}
    public void onPageCommitVisible(WebView view, String url) {}
    /** Never called on desktop, since WebKit can't answer a page's requests. */
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) { return shouldInterceptRequest(view, request.getUrl().toString()); }
    public WebResourceResponse shouldInterceptRequest(WebView view, String url) { return null; }
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return shouldOverrideUrlLoading(view, request.getUrl().toString()); }
    public boolean shouldOverrideUrlLoading(WebView view, String url) { return false; }
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {}
    public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {}
    public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {}
    public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) { return false; }
}
