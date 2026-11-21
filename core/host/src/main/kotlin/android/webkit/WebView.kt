package android.webkit

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.view.ViewGroup
import yomi.host.WebViews
import kotlinx.serialization.json.put
import java.lang.reflect.InvocationHandler
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/** Android's WebView, backed by a hidden WebKit view in Nano. shouldInterceptRequest is never called. */
open class WebView(context: Context?) : ViewGroup(context) {
    internal val id: Int = WebViews.register(this)
    private val settings = WebSettings()
    private var client: WebViewClient = WebViewClient()
    private var chromeClient: WebChromeClient? = null
    internal val interfaces = ConcurrentHashMap<String, Any>()
    internal val listeners = ConcurrentHashMap<String, Pair<List<String>, InvocationHandler>>()
    private val nextScript = AtomicInteger(1)
    @Volatile internal var destroyed = false
    @Volatile private var url: String? = null
    private var sentSettings: String? = null

    init {
        WebViews.send("create", id) {
            put("width", WebViews.cssWidth(this@WebView))
            put("height", WebViews.cssHeight(this@WebView))
        }
    }

    open fun getSettings(): WebSettings = settings
    open fun setWebViewClient(client: WebViewClient) { this.client = client }
    open fun getWebViewClient(): WebViewClient = client
    open fun setWebChromeClient(client: WebChromeClient?) { chromeClient = client }
    open fun getWebChromeClient(): WebChromeClient? = chromeClient
    open fun getUrl(): String? = url
    open fun getOriginalUrl(): String? = url
    open fun getTitle(): String? = null
    open fun getProgress(): Int = 100

    /** User agent and image blocking apply from the next load, as on Android. */
    private fun syncSettings() {
        val ua = settings.userAgentString
        val images = !settings.imagesBlocked()
        val key = "$ua|$images"
        if (key == sentSettings) return
        sentSettings = key
        WebViews.send("settings", id) {
            put("userAgent", ua)
            put("images", images)
        }
    }

    open fun loadUrl(url: String) = loadUrl(url, emptyMap())

    open fun loadUrl(url: String, additionalHttpHeaders: Map<String, String>) {
        if (destroyed) return
        syncSettings()
        this.url = url
        WebViews.send("load", id) {
            put("url", url)
            put("headers", WebViews.json(additionalHttpHeaders))
        }
    }

    open fun loadData(data: String, mimeType: String?, encoding: String?) = loadDataWithBaseURL("about:blank", data, mimeType, encoding, null)

    open fun loadDataWithBaseURL(baseUrl: String?, data: String, mimeType: String?, encoding: String?, historyUrl: String?) {
        if (destroyed) return
        syncSettings()
        url = baseUrl
        WebViews.send("loadHtml", id) {
            put("baseUrl", baseUrl ?: "about:blank")
            put("html", data)
        }
    }

    open fun reload() { url?.let { loadUrl(it) } }
    open fun stopLoading() { if (!destroyed) WebViews.send("stop", id) {} }
    open fun canGoBack(): Boolean = false
    open fun goBack() {}
    open fun clearCache(includeDiskFiles: Boolean) {}
    open fun clearHistory() {}
    open fun clearFormData() {}
    open fun onPause() {}
    open fun onResume() {}
    open fun pauseTimers() {}
    open fun resumeTimers() {}

    open fun evaluateJavascript(script: String, resultCallback: ValueCallback<String>?) {
        if (destroyed) return
        val cb = resultCallback?.let { WebViews.callback(it) }
        WebViews.send("eval", id) {
            put("script", script)
            if (cb != null) put("cb", cb)
        }
    }

    open fun addJavascriptInterface(obj: Any, name: String) {
        interfaces[name] = obj
        WebViews.send("addInterface", id) { put("name", name) }
    }

    open fun removeJavascriptInterface(name: String) { interfaces.remove(name) }

    /** Taps go to the page at the same spot, scaled from device pixels to CSS pixels. */
    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (destroyed) return false
        val density = resources.displayMetrics.density
        WebViews.send("touch", id) {
            put("action", event.actionMasked)
            put("x", event.x / density)
            put("y", event.y / density)
        }
        return true
    }

    /** Reported once the next frame could have drawn. The page never paints on screen here. */
    open fun postVisualStateCallback(requestId: Long, callback: VisualStateCallback) {
        Handler(Looper.getMainLooper()).postDelayed({ if (!destroyed) callback.onComplete(requestId) }, 32)
    }

    override fun onSizeChanged(width: Int, height: Int) {
        if (destroyed || width <= 0 || height <= 0) return
        WebViews.send("resize", id) {
            put("width", WebViews.cssWidth(this@WebView))
            put("height", WebViews.cssHeight(this@WebView))
        }
    }

    open fun destroy() {
        if (destroyed) return
        destroyed = true
        WebViews.send("destroy", id) {}
        WebViews.unregister(this)
    }

    /** A script for the start of every matching document, from the support-library glue. */
    internal fun addDocumentStartScript(script: String, rules: List<String>): Int {
        val scriptId = nextScript.getAndIncrement()
        WebViews.send("addScript", id) {
            put("script", script)
            put("rules", WebViews.json(rules))
        }
        return scriptId
    }

    internal fun addMessageListener(name: String, rules: List<String>, handler: InvocationHandler) {
        listeners[name] = rules to handler
        WebViews.send("addListener", id) { put("name", name) }
    }

    internal fun onPageStarted(url: String) { this.url = url; client.onPageStarted(this, url, null) }
    internal fun onPageFinished(url: String) { this.url = url; client.onPageFinished(this, url) }
    internal fun onConsole(message: ConsoleMessage) {
        if (chromeClient?.onConsoleMessage(message) != true) android.util.Log.d("WebView", message.message())
    }

    abstract class VisualStateCallback {
        abstract fun onComplete(requestId: Long)
    }

    companion object {
        @JvmStatic fun getWebViewClassLoader(): ClassLoader = WebView::class.java.classLoader
        @JvmStatic fun setWebContentsDebuggingEnabled(enabled: Boolean) {}
        @JvmStatic fun setDataDirectorySuffix(suffix: String) {}
        @JvmStatic fun getCurrentWebViewPackage(): Any? = null
    }
}
