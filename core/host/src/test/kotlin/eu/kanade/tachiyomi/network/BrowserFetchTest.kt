package eu.kanade.tachiyomi.network

import okhttp3.Request
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.IOException

class BrowserFetchTest {
    private val req = Request.Builder().url("https://a.test/x").header("User-Agent", "u").header("X-Test", "1").build()

    @Test
    fun theBrowserOwnsItsHeaders() {
        val js = BrowserFetch.script(7, req, "https://a.test")
        assertTrue(js.contains("X-Test"))
        assertFalse(js.contains("User-Agent"))
    }

    @Test
    fun aFetchReplyBecomesAResponse() {
        val reply = """{"status":404,"headers":[["content-type","text/plain"],["content-encoding","br"]],"body":"aGVsbG8="}"""
        val res = BrowserFetch.toResponse(req, reply)
        assertEquals(404, res.code)
        assertEquals("hello", res.body.string())
        assertNull(res.header("content-encoding"))
    }

    @Test
    fun aFailedFetchIsAnIOException() {
        assertThrows(IOException::class.java) { BrowserFetch.toResponse(req, """{"error":"TypeError: Load failed"}""") }
    }
}
