package yomi.host

import android.os.Handler
import android.os.Looper
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebView
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.io.PrintStream
import java.lang.reflect.InvocationHandler
import java.lang.reflect.Method
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/** Replies and the host's own requests to the app share stdout, one line at a time. */
object Protocol {
    lateinit var out: PrintStream
    private val lock = Any()
    // miharchy-core runs the host in-process with no app to show a WebView, so a source that needs one fails here.
    val attached get() = ::out.isInitialized
    fun send(line: String) = synchronized(lock) {
        if (!attached) throw WebViewUnavailableException()
        out.println(line)
    }
}

/** miharchy-core: the source needs a WebView, and core has none (ADR 0009). An IOException, so OkHttp passes it on. */
class WebViewUnavailableException : java.io.IOException("This source needs a WebView, which Miharchy does not have.")

/** Relays Android WebViews to the app's hidden WebKit views. Events run on the main Looper, like Android's callbacks. */
object WebViews {
    private val views = ConcurrentHashMap<Int, WebView>()
    private val nextId = AtomicInteger(1)
    private val callbacks = ConcurrentHashMap<Long, ValueCallback<String>>()
    private val nextCallback = AtomicLong(1)
    private val main by lazy { Handler(Looper.getMainLooper()) }
    private val javaBridge = Executors.newCachedThreadPool { Thread(it, "JavaBridge").apply { isDaemon = true } }

    private val presented = ConcurrentHashMap<Int, android.app.Dialog>()

    /** Shows [view] to the user. Closing the window cancels [dialog], like Back on Android. */
    fun present(view: WebView, dialog: android.app.Dialog) {
        presented[view.id] = dialog
        send("present", view.id) {}
    }

    fun dismissed(dialog: android.app.Dialog) {
        val id = presented.entries.firstOrNull { it.value === dialog }?.key ?: return
        presented.remove(id)
        send("unpresent", id) {}
    }

        /** Cookies the host stored go to WebKit too, since on Android the WebView and app share one store. */
    fun cookiesStored(url: String, setCookies: List<String>) {
        if (!Protocol.attached || views.isEmpty() || setCookies.isEmpty()) return
        send("cookies", 0) {
            put("url", url)
            put("cookies", json(setCookies))
        }
    }

    fun register(view: WebView): Int = nextId.getAndIncrement().also { views[it] = view }
    fun unregister(view: WebView) { views.remove(view.id) }
    fun callback(cb: ValueCallback<String>): Long = nextCallback.getAndIncrement().also { callbacks[it] = cb }

    fun cssWidth(v: WebView): Int = sizeOr(v.width, v.resources.displayMetrics.widthPixels, v)
    fun cssHeight(v: WebView): Int = sizeOr(v.height, v.resources.displayMetrics.heightPixels, v)
    private fun sizeOr(px: Int, fallback: Int, v: WebView) = ((if (px > 0) px else fallback) / v.resources.displayMetrics.density).toInt()

    fun json(map: Map<String, String>) = JsonObject(map.mapValues { JsonPrimitive(it.value) })
    fun json(list: List<String>) = JsonArray(list.map(::JsonPrimitive))

    fun send(op: String, view: Int, fields: JsonObjectBuilder.() -> Unit) {
        // miharchy-core: a view that cannot be shown must not stay registered, or later cookie syncs would fail too.
        if (!Protocol.attached) {
            views.remove(view)
            throw WebViewUnavailableException()
        }
        Protocol.send(buildJsonObject { put("wv", op); put("view", view); fields() }.toString())
    }

    fun onEvent(msg: JsonObject) {
        val view = views[msg["view"]?.jsonPrimitive?.intOrNull ?: -1]
        fun s(k: String) = msg[k]?.jsonPrimitive?.contentOrNull.orEmpty()
        when (s("wvEvent")) {
            "eval" -> {
                val cb = callbacks.remove(msg["cb"]?.jsonPrimitive?.content?.toLongOrNull() ?: return) ?: return
                main.post { cb.onReceiveValue(s("value").ifEmpty { "null" }) }
            }
            "pageStarted" -> view?.let { v -> main.post { if (!v.destroyed) v.onPageStarted(s("url")) } }
            "pageFinished" -> view?.let { v -> main.post { if (!v.destroyed) v.onPageFinished(s("url")) } }
            "console" -> view?.let { v ->
                val level = runCatching { ConsoleMessage.MessageLevel.valueOf(s("level").uppercase()) }.getOrDefault(ConsoleMessage.MessageLevel.LOG)
                main.post { v.onConsole(ConsoleMessage(s("message"), s("source"), msg["line"]?.jsonPrimitive?.intOrNull ?: 0, level)) }
            }
            // A request the page made. Extensions watch these through shouldInterceptRequest.
            "request" -> view?.let { v ->
                val url = s("url")
                val method = s("method").ifEmpty { "GET" }
                val isMain = msg["main"]?.jsonPrimitive?.booleanOrNull ?: false
                javaBridge.execute {
                    if (v.destroyed) return@execute
                    val request = object : android.webkit.WebResourceRequest {
                        override fun getUrl() = android.net.Uri.parse(url)
                        override fun isForMainFrame() = isMain
                        override fun isRedirect() = false
                        override fun hasGesture() = false
                        override fun getMethod() = method
                        override fun getRequestHeaders(): Map<String, String> = emptyMap()
                    }
                    val response = runCatching { v.getWebViewClient().shouldInterceptRequest(v, request) }
                        .onFailure { System.err.println("shouldInterceptRequest: $it") }
                        .getOrNull()
                    // Only fetch() waits for an answer. Tell it to go ahead or use this response.
                    val id = msg["id"]?.jsonPrimitive?.content ?: return@execute
                    if (v.destroyed) return@execute
                    // Offered to every frame, but only the one that asked has this id.
                    val script = "(function deliver(w) { try { w.__yomiIntercepted && w.__yomiIntercepted(${JsonPrimitive(id)}, ${answer(response)}); } catch (e) {} " +
                        "try { for (let i = 0; i < w.frames.length; i++) deliver(w.frames[i]); } catch (e) {} })(window)"
                    send("eval", v.id) { put("script", script) }
                }
            }
            "call" -> view?.let { v -> javaBridge.execute { callInterface(v, s("name"), s("method"), msg["args"]?.jsonArray.orEmpty()) } }
            "message" -> view?.let { v -> main.post { postMessage(v, s("name"), s("data"), s("origin"), msg["main"]?.jsonPrimitive?.booleanOrNull ?: true) } }
            "presentClosed" -> presented[msg["view"]?.jsonPrimitive?.intOrNull ?: -1]?.let { d -> main.post { d.cancel() } }
                        "gone" -> view?.let { v ->
                main.post {
                    if (v.destroyed) return@post
                    val crashed = msg["crashed"]?.jsonPrimitive?.booleanOrNull ?: true
                    v.getWebViewClient().onRenderProcessGone(v, object : RenderProcessGoneDetail() {
                        override fun didCrash() = crashed
                        override fun rendererPriorityAtExit() = 0
                    })
                }
            }
        }
    }

    /** null lets the fetch go ahead. Otherwise it's the response, with the body in base64. */
    private fun answer(r: android.webkit.WebResourceResponse?): String {
        if (r == null) return "null"
        val data = r.data ?: return """{"error":true}"""
        val body = runCatching { data.use { it.readBytes() } }.getOrDefault(ByteArray(0))
        return buildJsonObject {
            put("status", r.statusCode)
            put("reason", r.reasonPhrase ?: "OK")
            put("headers", json((r.responseHeaders ?: emptyMap()) + listOfNotNull(r.mimeType?.let { "Content-Type" to it }).toMap()))
            put("body", java.util.Base64.getEncoder().encodeToString(body))
        }.toString()
    }

    /** A page called `window.<name>.<method>(...)` on an object added with addJavascriptInterface. */
    private fun callInterface(view: WebView, name: String, method: String, args: List<JsonElement>) {
        val target = view.interfaces[name] ?: return
        val m = target.javaClass.methods.firstOrNull {
            it.name == method && it.parameterCount == args.size && it.isAnnotationPresent(JavascriptInterface::class.java)
        } ?: return
        try {
            m.isAccessible = true
            m.invoke(target, *m.parameterTypes.zip(args).map { (type, arg) -> convert(type, arg) }.toTypedArray())
        } catch (e: Throwable) {
            System.err.println("JavaScript interface $name.$method failed: $e")
        }
    }

    private fun convert(type: Class<*>, arg: JsonElement): Any? {
        val p = arg as? JsonPrimitive
        return when (type) {
            String::class.java -> p?.contentOrNull ?: arg.toString()
            Int::class.javaPrimitiveType, Int::class.javaObjectType -> p?.content?.toDoubleOrNull()?.toInt() ?: 0
            Long::class.javaPrimitiveType, Long::class.javaObjectType -> p?.content?.toDoubleOrNull()?.toLong() ?: 0L
            Double::class.javaPrimitiveType, Double::class.javaObjectType -> p?.content?.toDoubleOrNull() ?: 0.0
            Float::class.javaPrimitiveType, Float::class.javaObjectType -> p?.content?.toFloatOrNull() ?: 0f
            Boolean::class.javaPrimitiveType, Boolean::class.javaObjectType -> p?.booleanOrNull ?: false
            else -> null
        }
    }

    /** A page posted to a web message listener. Hand it over like Chromium does. */
    private fun postMessage(view: WebView, name: String, data: String, origin: String, isMainFrame: Boolean) {
        if (view.destroyed) return
        val (rules, handler) = view.listeners[name] ?: return
        if (!rules.any { originMatches(it, origin) }) return
        val payload = InvocationHandler { _, m, _ ->
            when (m.name) {
                "getType" -> 0
                "getAsString" -> data
                "getAsArrayBuffer" -> data.toByteArray()
                else -> null
            }
        }
        val message = InvocationHandler { _, m, _ ->
            when (m.name) {
                "getMessagePayload" -> payload
                "getData" -> data
                "getPorts" -> emptyArray<InvocationHandler>()
                else -> null
            }
        }
        val reply = InvocationHandler { _, m, args ->
            if (m.name == "postMessage") {
                val text = args?.getOrNull(0) as? String ?: return@InvocationHandler null
                send("eval", view.id) {
                    put("script", "(() => { const o = window[${JsonPrimitive(name)}]; o && typeof o.onmessage === 'function' && o.onmessage({ data: ${JsonPrimitive(text)} }); })()")
                }
            }
            null
        }
        try {
            handler.invoke(null, ON_POST_MESSAGE, arrayOf(view, message, android.net.Uri.parse(origin), isMainFrame, reply))
        } catch (e: Throwable) {
            System.err.println("web message listener $name failed: $e")
            e.printStackTrace()
        }
    }

    // Chromium's origin rules: "*", an origin, or a wildcard host like https://*.example.com.
    fun originMatches(rule: String, origin: String): Boolean {
        if (rule == "*") return true
        if (!rule.contains("*.")) return rule.trimEnd('/') == origin
        val (scheme, host) = rule.split("://", limit = 2).let { it[0] to it.getOrElse(1) { "" }.removePrefix("*.") }
        val o = origin.split("://", limit = 2)
        return o.size == 2 && o[0] == scheme && (o[1] == host || o[1].endsWith(".$host"))
    }

    private interface WebMessageListener {
        fun onPostMessage(view: WebView, message: InvocationHandler, sourceOrigin: android.net.Uri, isMainFrame: Boolean, replyProxy: InvocationHandler)
    }

    private val ON_POST_MESSAGE: Method = WebMessageListener::class.java.methods.first { it.name == "onPostMessage" }
}
