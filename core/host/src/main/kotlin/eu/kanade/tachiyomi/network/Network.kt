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
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.ResponseBody.Companion.toResponseBody

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

/** Reports a Cloudflare challenge page instead of handing its HTML to the extension, unless [FlareSolverr] passes it. */
class CloudflareInterceptor : okhttp3.Interceptor {
    override fun intercept(chain: okhttp3.Interceptor.Chain): okhttp3.Response {
        val req = chain.request()
        if (BrowserFetch.handles(req.url.host)) return BrowserFetch.fetch(req)
        val res = chain.proceed(req)
        if (!isChallenge(res)) return res
        res.close()
        FlareSolverr.pass(chain, req)?.let { return it }
        val ua = Injekt.get<NetworkHelper>().userAgents.forHost(req.url.host) ?: req.header("User-Agent") ?: NetworkHelper.USER_AGENT
        throw CloudflareChallengeException(req.url.toString(), ua)
    }
}

internal fun isChallenge(res: okhttp3.Response) = res.code in setOf(403, 503) && res.header("Server").orEmpty().startsWith("cloudflare") &&
    (res.header("cf-mitigated") == "challenge" || res.header("Content-Type").orEmpty().startsWith("text/html"))

/** A FlareSolverr-format solver: its base URL, and whether its page may stand in for the site's (`flareSolverrAsResponseFallback`). */
data class Solver(val url: String, val responseFallback: Boolean)

/**
 * Passes a Cloudflare challenge with a FlareSolverr-format solver (#361), as Suwayomi does. The solver's cookies and
 * user agent are kept, so the site's next requests pass without it; the request is then sent again, and only when
 * the site still challenges does the solver's page stand in for the reply.
 */
object FlareSolverr {
    /** The solver to use now, null when off. Core sets it to read its settings, so a change works at once. */
    @Volatile var settings: () -> Solver? = { null }

    // ponytail: one solve at a time across the host; per-site locks if one slow site holds up the others.
    private val lock = java.util.concurrent.locks.ReentrantLock()
    private val client by lazy { OkHttpClient.Builder().readTimeout(75, TimeUnit.SECONDS).callTimeout(80, TimeUnit.SECONDS).build() }

    fun pass(chain: okhttp3.Interceptor.Chain, req: Request): okhttp3.Response? {
        // ponytail: GET only; FlareSolverr's request.post (form bodies) is the upgrade.
        if (req.method != "GET") return null
        val solver = try { settings() } catch (e: Exception) { log("cannot read its settings: $e"); null } ?: return null
        val waited = !lock.tryLock()
        if (waited) lock.lock()
        try {
            // Another request may have solved this site while this one waited.
            if (waited) retry(chain, req)?.let { return it }
            val solution = try { solve(solver.url, req.url.toString()) } catch (e: Exception) { log("could not solve ${req.url}: ${e.message ?: e}"); return null }
            val network = Injekt.get<NetworkHelper>()
            if (solution.cookies.isNotEmpty()) network.cookieJar.saveFromResponse(req.url, solution.cookies)
            solution.userAgent?.let { network.userAgents.set(req.url.host, it) }
            retry(chain, req)?.let { return it }
            if (!solver.responseFallback) return null
            return okhttp3.Response.Builder().request(req).protocol(okhttp3.Protocol.HTTP_1_1).code(solution.status).message("")
                .header("Content-Type", solution.contentType)
                .body(solution.body.toResponseBody(solution.contentType.toMediaTypeOrNull()))
                .build()
        } finally {
            lock.unlock()
        }
    }

    private fun retry(chain: okhttp3.Interceptor.Chain, req: Request): okhttp3.Response? {
        val res = chain.proceed(req)
        if (!isChallenge(res)) return res
        res.close()
        return null
    }

    private class Solution(val status: Int, val contentType: String, val body: String, val cookies: List<okhttp3.Cookie>, val userAgent: String?)

    private fun solve(base: String, url: String): Solution {
        val ask = kotlinx.serialization.json.JsonObject(mapOf(
            "cmd" to kotlinx.serialization.json.JsonPrimitive("request.get"), "url" to kotlinx.serialization.json.JsonPrimitive(url),
            "maxTimeout" to kotlinx.serialization.json.JsonPrimitive(60_000),
        )).toString()
        val post = Request.Builder().url(base.trimEnd('/') + "/v1")
            .post(ask.toRequestBody("application/json".toMediaType())).build()
        val reply = client.newCall(post).execute().use { kotlinx.serialization.json.Json.parseToJsonElement(it.body.string()) }.jsonObject
        if (reply.str("status") != "ok") throw java.io.IOException(reply.str("message") ?: "the solver answered ${reply.str("status")}")
        val s = reply["solution"]?.jsonObject ?: throw java.io.IOException("the solver sent no solution")
        val headers = s["headers"] as? kotlinx.serialization.json.JsonObject
        val type = headers?.entries?.firstOrNull { it.key.equals("content-type", ignoreCase = true) }?.value?.jsonPrimitive?.content
        val site = url.toHttpUrl()
        val cookies = (s["cookies"] as? kotlinx.serialization.json.JsonArray).orEmpty().mapNotNull { c -> runCatching { cookie(c.jsonObject, site.host) }.getOrNull() }
        return Solution(s["status"]?.jsonPrimitive?.intOrNull?.takeIf { it in 100..599 } ?: 200, type ?: "text/html; charset=utf-8",
            s.str("response").orEmpty(), cookies, s.str("userAgent"))
    }

    /** One of the solver's cookies, as Selenium gives it: expiry in seconds, none for a session cookie. */
    private fun cookie(c: kotlinx.serialization.json.JsonObject, host: String): okhttp3.Cookie {
        val domain = c.str("domain") ?: host
        val b = okhttp3.Cookie.Builder().name(c.str("name")!!).value(c.str("value")!!).path(c.str("path") ?: "/")
        if (domain.startsWith(".")) b.domain(domain.trimStart('.')) else b.hostOnlyDomain(domain)
        c["expiry"]?.jsonPrimitive?.doubleOrNull?.takeIf { it > 0 }?.let { b.expiresAt((it * 1000).toLong()) }
        if (c["secure"]?.jsonPrimitive?.booleanOrNull == true) b.secure()
        if (c["httpOnly"]?.jsonPrimitive?.booleanOrNull == true) b.httpOnly()
        return b.build()
    }

    private fun kotlinx.serialization.json.JsonObject.str(k: String) = this[k]?.jsonPrimitive?.contentOrNull

    private fun log(what: String) = System.err.println("miharchy-core: FlareSolverr $what")
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
