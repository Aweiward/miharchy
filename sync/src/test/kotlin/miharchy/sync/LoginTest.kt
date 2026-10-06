package miharchy.sync

import com.sun.net.httpserver.HttpServer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import kotlinx.serialization.json.add
import java.net.InetSocketAddress
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

private const val UNAUTHORIZED = "Exception while fetching data (/metas) : Unauthorized\r\n\r\nsuwayomi.tachidesk.server.user.UnauthorizedException: Unauthorized"

/** A ui_login server as measured on Suwayomi v2.3: an unknown token gets 200 with an Unauthorized error. */
private class FakeServer {
    var password = "s3cret"
    val access = mutableSetOf<String>()
    val refresh = mutableSetOf<String>()
    val calls = mutableListOf<String>()
    private var issued = 0
    private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    val config get() = ServerConfig("http://127.0.0.1:${server.address.port}", "miharchy", "s3cret")

    init {
        server.createContext("/api/graphql") { ex ->
            val body = Json.parseToJsonElement(ex.requestBody.readBytes().decodeToString()).jsonObject
            val query = body.getValue("query").jsonPrimitive.content
            val vars = body["variables"]?.jsonObject
            val token = ex.requestHeaders.getFirst("Authorization")?.removePrefix("Bearer ")
            fun error(message: String) = buildJsonObject { putJsonArray("errors") { add(buildJsonObject { put("message", message) }) } }
            val reply = when {
                "login(" in query -> {
                    calls += "login" + (token?.let { " with token" } ?: "")
                    if (vars?.getValue("password")?.jsonPrimitive?.content != password) {
                        error("Exception while fetching data (/login) : Incorrect username or password.")
                    } else {
                        issued++
                        access += "a$issued"
                        refresh += "r$issued"
                        buildJsonObject { putJsonObject("data") { putJsonObject("login") { put("accessToken", "a$issued"); put("refreshToken", "r$issued") } } }
                    }
                }
                "refreshToken(" in query -> {
                    calls += "refresh"
                    if (vars?.getValue("refreshToken")?.jsonPrimitive?.content !in refresh) {
                        error("Exception while fetching data (/refreshToken) : The token was expected to have 3 parts, but got 0.")
                    } else {
                        issued++
                        access += "a$issued"
                        buildJsonObject { putJsonObject("data") { putJsonObject("refreshToken") { put("accessToken", "a$issued") } } }
                    }
                }
                else -> {
                    calls += "query $token"
                    if (token in access) buildJsonObject { putJsonObject("data") { putJsonObject("metas") { putJsonArray("nodes") { add(buildJsonObject { put("value", "/sync") }) } } } }
                    else error(UNAUTHORIZED)
                }
            }
            val bytes = reply.toString().toByteArray()
            ex.sendResponseHeaders(200, bytes.size.toLong())
            ex.responseBody.use { it.write(bytes) }
        }
        server.start()
    }

    fun stop() = server.stop(0)
}

class LoginTest {
    private val server = FakeServer()

    @AfterTest fun stop() = server.stop()

    @Test fun `a run logs in once without a token, then sends the access token`() {
        val desktop = Desktop(server.config)
        assertEquals("/sync", desktop.syncFolder())
        assertEquals("/sync", desktop.syncFolder())
        assertEquals(listOf("login", "query a1", "query a1"), server.calls)
    }

    @Test fun `an expired token is refreshed and the request goes once more`() {
        val desktop = Desktop(server.config)
        desktop.syncFolder()
        server.access.clear()
        assertEquals("/sync", desktop.syncFolder())
        assertEquals(listOf("login", "query a1", "query a1", "refresh", "query a2"), server.calls)
    }

    @Test fun `a failed refresh falls back to a new login`() {
        val desktop = Desktop(server.config)
        desktop.syncFolder()
        server.access.clear()
        server.refresh.clear()
        assertEquals("/sync", desktop.syncFolder())
        assertEquals(listOf("login", "query a1", "query a1", "refresh", "login", "query a2"), server.calls)
    }

    @Test fun `a wrong password stops the run with a clear message`() {
        server.password = "changed"
        val e = assertFailsWith<IllegalStateException> { Desktop(server.config).syncFolder() }
        assertEquals("Suwayomi refused the login with the username and password in server.json.", e.message)
        assertEquals(listOf("login"), server.calls)
    }

    @Test fun `only an Unauthorized error or a 401 refuses the token`() {
        assertTrue(refusedToken(200, buildJsonObject { putJsonArray("errors") { add(buildJsonObject { put("message", UNAUTHORIZED) }) } }.toString()))
        assertTrue(refusedToken(401, ""))
        assertFalse(refusedToken(200, """{"errors":[{"message":"Exception while fetching data (/x) : Not Unauthorized here"}]}"""))
        assertFalse(refusedToken(200, """{"data":{}}"""))
        assertFalse(refusedToken(200, "<html>"))
        assertFalse(refusedToken(500, ""))
    }
}
