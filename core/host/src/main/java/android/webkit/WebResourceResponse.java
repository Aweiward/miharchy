package android.webkit;

import java.io.InputStream;
import java.util.Map;

/** WebKit can't swap in responses for a page's requests, so these are built but never served. */
public class WebResourceResponse {
    private String mimeType, encoding, reason;
    private int status = 200;
    private Map<String, String> headers;
    private InputStream data;

    public WebResourceResponse(String mimeType, String encoding, InputStream data) { this.mimeType = mimeType; this.encoding = encoding; this.data = data; }
    public WebResourceResponse(String mimeType, String encoding, int statusCode, String reasonPhrase, Map<String, String> responseHeaders, InputStream data) {
        this(mimeType, encoding, data); status = statusCode; reason = reasonPhrase; headers = responseHeaders;
    }
    public String getMimeType() { return mimeType; }
    public String getEncoding() { return encoding; }
    public int getStatusCode() { return status; }
    public String getReasonPhrase() { return reason; }
    public Map<String, String> getResponseHeaders() { return headers; }
    public InputStream getData() { return data; }
    public void setData(InputStream data) { this.data = data; }
    public void setMimeType(String m) { mimeType = m; }
    public void setEncoding(String e) { encoding = e; }
    public void setStatusCodeAndReasonPhrase(int code, String phrase) { status = code; reason = phrase; }
    public void setResponseHeaders(Map<String, String> h) { headers = h; }
}
