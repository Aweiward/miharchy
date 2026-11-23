package eu.kanade.tachiyomi.network

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.get
import yomi.host.TestHostDir
import yomi.host.startHost
import java.net.InetSocketAddress
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * The FlareSolverr fallback (#361) against a fake Cloudflare site and a fake solver, both local. Each test uses its
 * own loopback address, because the host keeps cookies and user agents by host for the whole JVM.
 */
class FlareSolverrTest {
    private val servers = mutableListOf<HttpServer>()
    private val client by lazy { startHost(TestHostDir.dir); Injekt.get<NetworkHelper>().client }

    @AfterEach
    fun off() {
        FlareSolverr.settings = { null }
        servers.forEach { it.stop(0) }
    }

    private fun serve(address: String, handle: (HttpExchange) -> Triple<Int, String, String>): String {
        val server = HttpServer.create(InetSocketAddress(address, 0), 0).apply {
            executor = Executors.newCachedThreadPool()
            createContext("/") { ex ->
                val (code, type, body) = handle(ex)
                val bytes = body.toByteArray()
                ex.responseHeaders.add("Content-Type", type)
                if (code == 403) ex.responseHeaders.add("Server", "cloudflare")
                ex.sendResponseHeaders(code, bytes.size.toLong())
                ex.responseBody.write(bytes)
                ex.close()
            }
            start()
        }
        servers += server
        return "http://$address:${server.address.port}"
    }

    /** A site that challenges until a request brings the solver's cookie and user agent, or always when [always]. */
    private fun site(address: String, always: Boolean = false) = serve(address) { ex ->
        val passed = ex.requestHeaders.getFirst("Cookie").orEmpty().contains("cf_clearance=ok") && ex.requestHeaders.getFirst("User-Agent") == "SolverUA"
        if (passed && !always) Triple(200, "application/json", """{"ok":true}""") else Triple(403, "text/html", "<html>Just a moment...</html>")
    }

    /** A solver that hands out the cookie for [host], or an error when [fail]; [calls] counts the solves. */
    private fun solver(host: String, calls: AtomicInteger, fail: Boolean = false) = serve("127.0.0.1") { ex ->
        calls.incrementAndGet()
        Thread.sleep(300)
        val expires = System.currentTimeMillis() / 1000 + 3600
        Triple(200, "application/json", if (fail) """{"status":"error","message":"Challenge not detected"}""" else """
            {"status":"ok","solution":{"status":200,"headers":{},"response":"<html>solved</html>","userAgent":"SolverUA",
             "cookies":[{"name":"cf_clearance","value":"ok","domain":"$host","path":"/","expiry":$expires,"secure":false,"httpOnly":true,"sameSite":"None"}]}}""")
    }

    private fun get(url: String) = client.newCall(Request.Builder().url(url).build()).execute()

    @Test
    fun aSolvedChallengeKeepsTheCookieAndTheSitesOwnReply() {
        val calls = AtomicInteger()
        val url = site("127.0.0.2")
        val base = solver("127.0.0.2", calls)
        FlareSolverr.settings = { Solver(base, responseFallback = true) }
        get("$url/a").use { r ->
            assertEquals(200, r.code)
            assertEquals("application/json", r.header("Content-Type"), "the site's own reply, not the solver's HTML")
            assertEquals("""{"ok":true}""", r.body.string())
        }
        get("$url/b").use { assertEquals(200, it.code) }
        assertEquals(1, calls.get(), "the next request passes with the stored cookie and user agent")
        val saved = java.io.File(TestHostDir.dir, "files/cookies.txt").readText()
        assert(saved.lines().any { it.startsWith("http://127.0.0.2/") && "cf_clearance=ok" in it }) { "the cookie outlives a restart: $saved" }
    }

    @Test
    fun whenTheCookieIsNotEnoughTheSolversPageStandsIn() {
        val calls = AtomicInteger()
        val url = site("127.0.0.3", always = true)
        val base = solver("127.0.0.3", calls)
        FlareSolverr.settings = { Solver(base, responseFallback = true) }
        get(url).use { r ->
            assertEquals(200, r.code)
            assertEquals("text/html; charset=utf-8", r.header("Content-Type"))
            assertEquals("<html>solved</html>", r.body.string())
        }
        FlareSolverr.settings = { Solver(base, responseFallback = false) }
        assertThrows<CloudflareChallengeException> { get(url) }
    }

    @Test
    fun offFailingOrAPostReportsTheChallenge() {
        val calls = AtomicInteger()
        val url = site("127.0.0.4")
        assertThrows<CloudflareChallengeException> { get(url) }
        val failing = solver("127.0.0.4", calls, fail = true)
        FlareSolverr.settings = { Solver(failing, responseFallback = true) }
        assertThrows<CloudflareChallengeException> { get(url) }
        assertEquals(1, calls.get())
        val working = solver("127.0.0.4", calls)
        FlareSolverr.settings = { Solver(working, responseFallback = true) }
        assertThrows<CloudflareChallengeException> { client.newCall(Request.Builder().url(url).post("x".toRequestBody()).build()).execute() }
        assertEquals(1, calls.get(), "a POST never reaches the solver")
        FlareSolverr.settings = { Solver("http://127.0.0.1:1", responseFallback = true) }
        assertThrows<CloudflareChallengeException> { get("$url/down") }
    }

    @Test
    fun requestsThatWaitForASolveUseItsCookie() {
        val calls = AtomicInteger()
        val url = site("127.0.0.5")
        val base = solver("127.0.0.5", calls)
        FlareSolverr.settings = { Solver(base, responseFallback = false) }
        val pool = Executors.newFixedThreadPool(4)
        val codes = (1..4).map { i -> pool.submit<Int> { get("$url/$i").use { it.code } } }.map { it.get() }
        pool.shutdown()
        assertEquals(listOf(200, 200, 200, 200), codes)
        assertEquals(1, calls.get(), "one solve serves every request that waited for it")
    }
}
