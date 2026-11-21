@file:JvmName("RequestsKt")

package eu.kanade.tachiyomi.network

import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.get
import android.content.Context
import okhttp3.CacheControl
import okhttp3.Headers
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.Cache
import okhttp3.OkHttpClient
import java.io.File
import java.util.concurrent.TimeUnit

private val DEFAULT_CACHE_CONTROL = CacheControl.Builder().maxAge(10, TimeUnit.MINUTES).build()
private val DEFAULT_HEADERS = Headers.Builder().build()
private val DEFAULT_BODY: RequestBody = okhttp3.FormBody.Builder().build()

fun GET(url: String, headers: Headers = DEFAULT_HEADERS, cache: CacheControl = DEFAULT_CACHE_CONTROL): Request =
    GET(url.toHttpUrl(), headers, cache)

fun GET(url: HttpUrl, headers: Headers = DEFAULT_HEADERS, cache: CacheControl = DEFAULT_CACHE_CONTROL): Request =
    Request.Builder().url(url).headers(headers).cacheControl(cache).build()

fun POST(
    url: String,
    headers: Headers = DEFAULT_HEADERS,
    body: RequestBody = DEFAULT_BODY,
    cache: CacheControl = DEFAULT_CACHE_CONTROL,
): Request = Request.Builder().url(url).post(body).headers(headers).cacheControl(cache).build()

class HttpException(val code: Int) : IllegalStateException("HTTP error $code")

class NetworkHelper(context: Context) {
    /** Every extension builds its client from this one, so a solved challenge works for all of them. */
    val cookieJar = HostCookieJar(File(context.filesDir, "cookies.txt"))

    /** cf_clearance only works with the user agent that earned it. */
    val userAgents = UserAgentOverrides(File(context.filesDir, "useragents.txt"))

    // keiyoushi's shared code looks for these three interceptors by name and adds its own gzip and brotli handling.
    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(2, TimeUnit.MINUTES)
        .cache(Cache(File(context.cacheDir, "network"), 5L * 1024 * 1024))
        .addInterceptor(UncaughtExceptionInterceptor())
        .addInterceptor(UserAgentInterceptor())
        .addInterceptor(CloudflareInterceptor())
        .addNetworkInterceptor(userAgents) // last, so it wins over whatever the extension set
        .cookieJar(cookieJar)
        .build()

    companion object {
        const val USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"
    }
}

/** Rethrows other exceptions as IOException so OkHttp reports them instead of crashing its thread. keiyoushi checks for it by name. */
class UncaughtExceptionInterceptor : okhttp3.Interceptor {
    override fun intercept(chain: okhttp3.Interceptor.Chain): okhttp3.Response = try {
        chain.proceed(chain.request())
    } catch (e: Exception) {
        throw if (e is java.io.IOException) e else java.io.IOException(e)
    }
}

class UserAgentInterceptor : okhttp3.Interceptor {
    override fun intercept(chain: okhttp3.Interceptor.Chain): okhttp3.Response {
        val req = chain.request()
        if (!req.header("User-Agent").isNullOrEmpty()) return chain.proceed(req)
        return chain.proceed(req.newBuilder().removeHeader("User-Agent").addHeader("User-Agent", NetworkHelper.USER_AGENT).build())
    }
}

/** Remembers the user agent that passed a site's challenge (Byparr picks its own) and uses it for the site and its subdomains. */
class UserAgentOverrides(private val file: File) : okhttp3.Interceptor {
    private val byHost = java.util.concurrent.ConcurrentHashMap<String, String>()

    init {
        if (file.exists()) {
            file.readLines().forEach { line ->
                val (host, ua) = line.split('\t', limit = 2).takeIf { it.size == 2 } ?: return@forEach
                byHost[host] = ua
            }
        }
    }

    fun set(host: String, userAgent: String) {
        byHost[host] = userAgent
        val tmp = File(file.path + ".tmp")
        tmp.writeText(byHost.entries.joinToString("") { "${it.key}\t${it.value}\n" })
        java.nio.file.Files.move(tmp.toPath(), file.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE)
    }

    fun forHost(host: String): String? =
        generateSequence(host) { h -> h.substringAfter('.', "").takeIf { it.contains('.') } }.firstNotNullOfOrNull { byHost[it] }

    override fun intercept(chain: okhttp3.Interceptor.Chain): okhttp3.Response {
        val req = chain.request()
        val ua = forHost(req.url.host) ?: return chain.proceed(req)
        return chain.proceed(req.newBuilder().header("User-Agent", ua).build())
    }
}

/** A Cloudflare challenge the app has to solve in a webview with exactly [userAgent], then send back the cookies. */
class CloudflareChallengeException(val url: String, val userAgent: String) :
    java.io.IOException("Cloudflare challenge at $url")

/** Reports a Cloudflare challenge page instead of handing its HTML to the extension. */
class CloudflareInterceptor : okhttp3.Interceptor {
    override fun intercept(chain: okhttp3.Interceptor.Chain): okhttp3.Response {
        val req = chain.request()
        if (BrowserFetch.handles(req.url.host)) return BrowserFetch.fetch(req)
        val res = chain.proceed(req)
        if (res.code in setOf(403, 503) && res.header("Server").orEmpty().startsWith("cloudflare") &&
            (res.header("cf-mitigated") == "challenge" || res.header("Content-Type").orEmpty().startsWith("text/html"))
        ) {
            res.close()
            val ua = Injekt.get<NetworkHelper>().userAgents.forHost(req.url.host) ?: req.header("User-Agent") ?: NetworkHelper.USER_AGENT
            throw CloudflareChallengeException(req.url.toString(), ua)
        }
        return res
    }
}

/** Cookies saved to [file] through a temp file, so a crash can't cut it short. */
class HostCookieJar(private val file: File) : okhttp3.CookieJar {
    private val cookies = LinkedHashMap<String, okhttp3.Cookie>()

    init {
        if (file.exists()) {
            file.readLines().forEach { line ->
                val (url, raw) = line.split('\t', limit = 2).takeIf { it.size == 2 } ?: return@forEach
                val u = url.toHttpUrlOrNull() ?: return@forEach
                okhttp3.Cookie.parse(u, raw)?.let { cookies[key(it)] = it }
            }
        }
    }

    private fun key(c: okhttp3.Cookie) = "${c.name}|${c.domain}|${c.path}"

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<okhttp3.Cookie>) {
        cookies.forEach { this.cookies[key(it)] = it }
        persist()
        yomi.host.WebViews.cookiesStored(url.toString(), cookies.map { it.toString() })
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<okhttp3.Cookie> {
        val now = System.currentTimeMillis()
        cookies.values.removeIf { it.expiresAt < now }
        return cookies.values.filter { it.matches(url) }
    }

    /** Takes Set-Cookie values from the app's webview. */
    fun add(url: HttpUrl, setCookies: List<String>) =
        saveFromResponse(url, setCookies.map { okhttp3.Cookie.parse(url, it) ?: throw IllegalArgumentException("bad cookie: $it") })

    private fun persist() {
        val tmp = File(file.path + ".tmp")
        tmp.writeText(
            cookies.values.filter { it.persistent && it.expiresAt > System.currentTimeMillis() }
                .joinToString("") { "${if (it.secure) "https" else "http"}://${it.domain}${it.path}\t$it\n" },
        )
        java.nio.file.Files.move(tmp.toPath(), file.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE)
    }
}

class JavaScriptEngine(context: Context) {
    // No JS engine bundled. Rhino (about 1.3 MB) if an extension ever needs evaluate().
    suspend fun <T> evaluate(script: String): T =
        throw UnsupportedOperationException("JavaScriptEngine is not available in this host")
}
