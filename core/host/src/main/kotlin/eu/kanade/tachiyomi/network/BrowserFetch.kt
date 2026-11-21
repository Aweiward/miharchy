package eu.kanade.tachiyomi.network

import android.app.Application
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.Headers
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.get
import java.io.IOException
import java.util.Base64
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

private const val PASSED_JS = """(() => {
  const challenge = /just a moment|attention required|un instant/i.test(document.title || '')
    || !!document.querySelector('#challenge-form, #challenge-running, #challenge-stage, #cf-challenge-running, [name="cf-turnstile-response"]');
  return document.readyState === 'complete' && !challenge && !!document.body && document.body.innerText.trim().length > 0;
})()"""

/** What a page can't set on fetch(), or must not: the browser owns these. */
private val BROWSER_HEADERS = setOf(
    "host", "user-agent", "cookie", "referer", "origin", "content-length", "accept-encoding", "connection", "keep-alive",
    "te", "trailer", "transfer-encoding", "upgrade", "via", "expect", "date", "dnt",
)

/** What fetch() gives back already decoded, so these would be wrong on the response we build. */
private val DECODED_HEADERS = setOf("content-encoding", "content-length", "transfer-encoding")

/** Sites that refuse OkHttp even after the browser passes their check get their requests run as fetch() in a hidden browser view. */
object BrowserFetch {
    private val hosts = ConcurrentHashMap.newKeySet<String>()
    private val views = ConcurrentHashMap<String, Session>()
    private val replies = ConcurrentHashMap<Int, CompletableFuture<String>>()
    private val nextId = AtomicInteger(1)

    fun add(host: String) {
        hosts += host
    }

    fun handles(host: String) = host in hosts

    class Bridge {
        @JavascriptInterface
        fun done(id: Int, json: String) {
            replies.remove(id)?.complete(json)
        }
    }

    /** One view per site. It opens the first page asked for and waits for it to stop being a check. */
    private class Session(host: String, val origin: String, start: String) {
        val view = WebView(Application())
        val ready = CompletableFuture<Unit>()
        @Volatile var asked = false

        init {
            view.getSettings().setUserAgentString(Injekt.get<NetworkHelper>().userAgents.forHost(host) ?: NetworkHelper.USER_AGENT)
            view.addJavascriptInterface(Bridge(), "NanoFetch")
            view.loadUrl(start)
            Thread {
                repeat(40) {
                    val answer = CompletableFuture<String>()
                    view.evaluateJavascript(PASSED_JS) { answer.complete(it) }
                    if (runCatching { answer.get(5, TimeUnit.SECONDS) }.getOrNull() == "true") {
                        ready.complete(Unit)
                        return@Thread
                    }
                    Thread.sleep(1000)
                }
                ready.completeExceptionally(IOException("$origin didn't pass its check in the browser"))
            }.apply { isDaemon = true }.start()
        }
    }

    fun fetch(req: Request): Response {
        val url = req.url
        val origin = "${url.scheme}://${url.host}" + if (url.port == okhttp3.HttpUrl.defaultPort(url.scheme)) "" else ":${url.port}"
        val session = views.computeIfAbsent(url.host) { Session(url.host, origin, url.toString()) }
        try {
            session.ready.get(60, TimeUnit.SECONDS)
        } catch (e: Exception) {
            views.remove(url.host)
            throw IOException(e.cause?.message ?: "The browser didn't open ${url.host}", e)
        }
        val first = send(session, req, origin)
        if (first.code != 403 || session.asked) return first
        first.close()
        session.asked = true
        show(session)
        return send(session, req, origin)
    }

    /** The site refused the browser too, so the person gets the page to click through, like Open in WebView on Android. */
    private fun show(session: Session) {
        val closed = java.util.concurrent.CountDownLatch(1)
        val dialog = android.app.Dialog(Application())
        dialog.setOnDismissListener { closed.countDown() }
        dialog.setContentView(session.view)
        dialog.show()
        closed.await(5, TimeUnit.MINUTES)
    }

    private fun send(session: Session, req: Request, origin: String): Response {
        val id = nextId.getAndIncrement()
        val reply = CompletableFuture<String>().also { replies[id] = it }
        try {
            session.view.evaluateJavascript(script(id, req, origin), null)
            return toResponse(req, reply.get(60, TimeUnit.SECONDS))
        } catch (e: java.util.concurrent.TimeoutException) {
            throw IOException("The browser took too long to fetch ${req.url}", e)
        } finally {
            replies.remove(id)
        }
    }

    internal fun script(id: Int, req: Request, origin: String): String {
        val headers = buildJsonObject {
            req.headers.forEach { (k, v) -> if (k.lowercase() !in BROWSER_HEADERS && !k.lowercase().startsWith("sec-") && !k.lowercase().startsWith("proxy-")) put(k, v) }
            req.body?.contentType()?.let { if (req.header("Content-Type") == null) put("Content-Type", it.toString()) }
        }
        val referrer = req.header("Referer")?.takeIf { it.startsWith("$origin/") }
        val body = req.body?.let { Base64.getEncoder().encodeToString(Buffer().also(it::writeTo).readByteArray()) }
        val bodyExpr = if (body == null) "undefined" else "Uint8Array.from(atob(${JsonPrimitive(body)}), c => c.charCodeAt(0))"
        return """(async () => {
  const send = (o) => window.NanoFetch.done($id, JSON.stringify(o));
  try {
    const r = await fetch(${JsonPrimitive(req.url.toString())}, { method: ${JsonPrimitive(req.method)}, headers: $headers, credentials: 'include', ${if (referrer != null) "referrer: ${JsonPrimitive(referrer)}, " else ""}body: $bodyExpr });
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > 3000000) return send({ error: 'The response is too big to bring through the browser' });
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    send({ status: r.status, headers: [...r.headers], body: btoa(s) });
  } catch (e) { send({ error: String(e) }); }
})()"""
    }

    internal fun toResponse(req: Request, json: String): Response {
        val o = Json.parseToJsonElement(json).jsonObject
        o["error"]?.let { throw IOException(it.jsonPrimitive.content) }
        val headers = Headers.Builder().apply {
            o["headers"]!!.jsonArray.forEach { pair ->
                val (k, v) = pair.jsonArray.map { it.jsonPrimitive.content }
                if (k.lowercase() !in DECODED_HEADERS) add(k, v)
            }
        }.build()
        val bytes = Base64.getDecoder().decode(o["body"]!!.jsonPrimitive.content)
        return Response.Builder()
            .request(req)
            .protocol(Protocol.HTTP_1_1)
            .code(o["status"]!!.jsonPrimitive.content.toInt())
            .message("")
            .headers(headers)
            .body(bytes.toResponseBody(headers["Content-Type"]?.toMediaTypeOrNull()))
            .build()
    }
}
