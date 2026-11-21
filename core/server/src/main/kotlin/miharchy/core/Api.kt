package miharchy.core

import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.install
import io.ktor.server.request.receiveText
import io.ktor.server.response.header
import io.ktor.server.response.respondBytes
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import io.ktor.server.websocket.WebSockets
import io.ktor.server.websocket.webSocket
import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.WebSocketSession
import io.ktor.websocket.close
import io.ktor.websocket.readText
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.security.MessageDigest

/** The error kinds of ADR 0010. `internal` is a failure inside core itself, not in a source. */
enum class Kind(val status: HttpStatusCode) {
    unauthorized(HttpStatusCode.Unauthorized),
    notFound(HttpStatusCode.NotFound),
    invalid(HttpStatusCode.BadRequest),
    cloudflare(HttpStatusCode.BadGateway),
    webview(HttpStatusCode.BadGateway),
    source(HttpStatusCode.BadGateway),
    network(HttpStatusCode.BadGateway),
    `internal`(HttpStatusCode.InternalServerError),
}

class ApiError(val kind: Kind, message: String) : Exception(message)

/** One RPC route: the request's JSON object in, the reply out. */
typealias Route = suspend (JsonObject) -> JsonElement

/**
 * What the API serves. Each slice of map #359 adds its routes and topics.
 * A topic's flow sends the full state first, then each change (ADR 0010).
 */
class Core(
    val secret: String,
    val db: Database,
    routes: Map<String, Route> = emptyMap(),
    val topics: Map<String, Flow<JsonElement>> = emptyMap(),
    val images: Map<String, ImageRoute> = emptyMap(),
) {
    val routes: Map<String, Route> = mapOf<String, Route>(
        "health" to { buildJsonObject { put("ok", true); put("schema", db.run { db.schema }) } },
    ) + routes

    init { require("health" !in routes) { "health is core's own route" } }

    /** Compared in constant time, so the reply time does not leak the secret. */
    fun accepts(secret: String?) = secret != null && MessageDigest.isEqual(secret.toByteArray(), this.secret.toByteArray())
}

private fun errorJson(kind: Kind, message: String) = buildJsonObject {
    put("error", buildJsonObject { put("kind", kind.name); put("message", message) })
}

private suspend fun ApplicationCall.reply(status: HttpStatusCode, body: JsonElement) =
    respondText(body.toString(), ContentType.Application.Json, status)

private fun ApplicationCall.authorize(core: Core) {
    if (!core.accepts(request.headers["Authorization"]?.takeIf { it.startsWith("Bearer ") }?.removePrefix("Bearer "))) {
        throw ApiError(Kind.unauthorized, "Send the secret from core.json as Authorization: Bearer <secret>.")
    }
}

fun Application.api(core: Core) {
    install(WebSockets)
    routing {
        post("/api/{name}") {
            val name = call.parameters["name"].orEmpty()
            val result = try {
                call.authorize(core)
                val route = core.routes[name] ?: throw ApiError(Kind.notFound, "There is no route $name.")
                val text = call.receiveText()
                val input = if (text.isBlank()) JsonObject(emptyMap()) else {
                    runCatching { Json.parseToJsonElement(text) as JsonObject }.getOrNull()
                        ?: throw ApiError(Kind.invalid, "The body must be one JSON object.")
                }
                HttpStatusCode.OK to route(input)
            } catch (e: ApiError) {
                e.kind.status to errorJson(e.kind, e.message.orEmpty())
            } catch (e: Exception) {
                e.printStackTrace()
                Kind.`internal`.status to errorJson(Kind.`internal`, "${e::class.java.simpleName}: ${e.message}")
            }
            call.reply(result.first, result.second)
        }
        // Covers and pages. The window fetches them with the same secret (ServerImage.qml).
        get("/api/{kind}/{path...}") {
            try {
                call.authorize(core)
                val route = core.images[call.parameters["kind"].orEmpty()] ?: throw ApiError(Kind.notFound, "There is no image route.")
                val image = route(call.parameters.getAll("path").orEmpty())
                call.response.header(HttpHeaders.CacheControl, "private, max-age=3600")
                call.respondBytes(image.bytes, ContentType.parse(image.contentType))
            } catch (e: ApiError) {
                call.reply(e.kind.status, errorJson(e.kind, e.message.orEmpty()))
            } catch (e: Exception) {
                e.printStackTrace()
                call.reply(Kind.`internal`.status, errorJson(Kind.`internal`, "${e::class.java.simpleName}: ${e.message}"))
            }
        }
        webSocket("/api/live") { live(core) }
    }
}

/**
 * The live socket (ADR 0010). The first message must be `{ secret }` within 10 s, else the
 * socket closes with 4401. Then `{ subscribe: <topic> }` starts a topic, sent as
 * `{ topic, data }`, and `{ type: "ping" }` gets `{ type: "pong" }`, as `window/Live.js` expects.
 */
private suspend fun WebSocketSession.live(core: Core) {
    val first = withTimeoutOrNull(10_000) { incoming.receiveCatching().getOrNull() } as? Frame.Text
    val secret = first?.let { runCatching { Json.parseToJsonElement(it.readText()).jsonObject["secret"]?.jsonPrimitive?.content }.getOrNull() }
    if (!core.accepts(secret)) {
        close(CloseReason(4401, "unauthorized"))
        return
    }
    val sending = Mutex()
    suspend fun send(message: JsonElement) = sending.withLock { outgoing.send(Frame.Text(message.toString())) }
    val running = mutableMapOf<String, Job>()
    for (frame in incoming) {
        val message = (frame as? Frame.Text)?.let { runCatching { Json.parseToJsonElement(it.readText()).jsonObject }.getOrNull() } ?: continue
        if ((message["type"] as? JsonPrimitive)?.content == "ping") {
            send(buildJsonObject { put("type", "pong") })
            continue
        }
        val topic = (message["subscribe"] as? JsonPrimitive)?.content ?: continue
        if (topic in running) continue
        val flow = core.topics[topic]
        if (flow == null) {
            send(buildJsonObject { put("topic", topic); put("error", errorJson(Kind.notFound, "There is no topic $topic.")["error"]!!) })
            continue
        }
        running[topic] = launch { flow.collect { data -> send(buildJsonObject { put("topic", topic); put("data", data) }) } }
    }
}
