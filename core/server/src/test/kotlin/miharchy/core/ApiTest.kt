package miharchy.core

import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.client.statement.readRawBytes
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import io.ktor.websocket.Frame
import io.ktor.websocket.readText
import kotlinx.coroutines.flow.flowOf
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals

class ApiTest {
    private val secret = "s3cret"
    private val core = Core(
        secret,
        Database(Files.createTempDirectory("core").resolve("core.db")),
        routes = mapOf("boom" to { _ -> error("bug in core") }, "echo" to { input -> input }),
        topics = mapOf("counter" to flowOf(JsonPrimitive(1), JsonPrimitive(2))),
        images = mapOf("cover" to { path -> if (path == listOf("7")) Image(byteArrayOf(1, 2), "image/png") else throw ApiError(Kind.notFound, "no") }),
    )

    private fun run(block: suspend ApplicationTestBuilder.(HttpClient) -> Unit) = testApplication {
        application { api(core) }
        block(createClient { install(WebSockets) })
    }

    private suspend fun HttpClient.call(name: String, body: String = "", auth: String? = "Bearer $secret"): Pair<Int, JsonObject> {
        val res = post("/api/$name") { auth?.let { header("Authorization", it) }; setBody(body) }
        return res.status.value to Json.parseToJsonElement(res.bodyAsText()).jsonObject
    }

    private fun JsonObject.kind() = this["error"]!!.jsonObject["kind"]!!.jsonPrimitive.content

    @Test
    fun healthAnswersWithTheSecret() = run { client ->
        val (status, body) = client.call("health")
        assertEquals(200, status)
        assertEquals("true", body["ok"].toString())
        assertEquals(Database.MIGRATIONS.size.toString(), body["schema"].toString())
    }

    @Test
    fun aMissingOrWrongSecretIsRefused() = run { client ->
        for (auth in listOf(null, "Bearer wrong", secret)) {
            val (status, body) = client.call("health", auth = auth)
            assertEquals(401, status)
            assertEquals("unauthorized", body.kind())
        }
    }

    @Test
    fun errorsCarryAKind() = run { client ->
        assertEquals(404 to "notFound", client.call("nope").let { it.first to it.second.kind() })
        assertEquals(400 to "invalid", client.call("echo", "[1]").let { it.first to it.second.kind() })
        assertEquals(500 to "internal", client.call("boom").let { it.first to it.second.kind() })
    }

    @Test
    fun aRouteGetsTheBody() = run { client ->
        assertEquals(200 to """{"a":1}""", client.call("echo", """{"a":1}""").let { it.first to it.second.toString() })
    }

    @Test
    fun imagesNeedTheSecretToo() = run { client ->
        val ok = client.get("/api/cover/7") { header("Authorization", "Bearer $secret") }
        assertEquals(200 to "image/png", ok.status.value to ok.headers["Content-Type"])
        assertEquals(2, ok.readRawBytes().size)
        assertEquals(401, client.get("/api/cover/7").status.value)
        assertEquals(404, client.get("/api/cover/8") { header("Authorization", "Bearer $secret") }.status.value)
        assertEquals(404, client.get("/api/nope/1") { header("Authorization", "Bearer $secret") }.status.value)
    }

    @Test
    fun theLiveSocketClosesWithoutTheSecret() = run { client ->
        client.webSocket("/api/live") {
            send(Frame.Text("""{"secret":"wrong"}"""))
            assertEquals(4401, closeReason.await()!!.code.toInt())
        }
    }

    @Test
    fun theLiveSocketAnswersPingsAndSendsTopics() = run { client ->
        client.webSocket("/api/live") {
            send(Frame.Text("""{"secret":"$secret"}"""))
            send(Frame.Text("""{"type":"ping"}"""))
            assertEquals("""{"type":"pong"}""", (incoming.receive() as Frame.Text).readText())
            send(Frame.Text("""{"subscribe":"counter"}"""))
            assertEquals("""{"topic":"counter","data":1}""", (incoming.receive() as Frame.Text).readText())
            assertEquals("""{"topic":"counter","data":2}""", (incoming.receive() as Frame.Text).readText())
            send(Frame.Text("""{"subscribe":"nope"}"""))
            val reply = Json.parseToJsonElement((incoming.receive() as Frame.Text).readText()).jsonObject
            assertEquals("notFound", reply.kind())
        }
    }
}
