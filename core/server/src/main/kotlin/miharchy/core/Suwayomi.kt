package miharchy.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import miharchy.sync.ServerConfig
import miharchy.sync.refusedToken
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse

/**
 * A reader of a v1.1.1 install's Suwayomi-Server (#372), for the move: its GraphQL with ui_login's tokens (ADR 0005),
 * and its files. It only reads: the move never writes to Suwayomi.
 */
class Suwayomi(private val config: ServerConfig) {
    private val http = HttpClient.newHttpClient()
    private val endpoint = URI.create(config.url.trimEnd('/') + "/api/graphql")
    private var access: String? = null

    /** The `data` of [query]. */
    suspend fun query(query: String, variables: JsonObject = JsonObject(emptyMap())): JsonObject {
        val body = buildJsonObject { put("query", query); put("variables", variables) }.toString()
        val response = authorized(HttpResponse.BodyHandlers.ofString(), { refusedToken(it.statusCode(), it.body()) }) {
            HttpRequest.newBuilder(endpoint).header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body))
        }
        if (response.statusCode() != 200) throw ApiError(Kind.network, "Suwayomi answered HTTP ${response.statusCode()}.")
        val json = Json.parseToJsonElement(response.body()).jsonObject
        json["errors"]?.let { throw ApiError(Kind.source, "Suwayomi refused a query: $it") }
        return json["data"]!!.jsonObject
    }

    /** A file Suwayomi serves, such as a backup it made: [path] is relative to its address. */
    suspend fun file(path: String): ByteArray {
        val response = authorized(HttpResponse.BodyHandlers.ofByteArray(), { it.statusCode() == 401 }) { HttpRequest.newBuilder(endpoint.resolve(path)).GET() }
        if (response.statusCode() != 200) throw ApiError(Kind.network, "Suwayomi answered HTTP ${response.statusCode()} for $path.")
        return response.body()
    }

    private suspend fun <T> authorized(handler: HttpResponse.BodyHandler<T>, refused: (HttpResponse<T>) -> Boolean, request: () -> HttpRequest.Builder): HttpResponse<T> =
        withContext(Dispatchers.IO) {
            fun attempt(token: String) = http.send(request().header("Authorization", "Bearer $token").build(), handler)
            val first = attempt(access ?: login())
            if (refused(first)) attempt(login()) else first
        }

    private fun login(): String {
        val body = buildJsonObject {
            put("query", "mutation(\$u: String!, \$p: String!) { login(input: { username: \$u, password: \$p }) { accessToken } }")
            put("variables", buildJsonObject { put("u", config.username); put("p", config.password) })
        }.toString()
        val response = http.send(
            HttpRequest.newBuilder(endpoint).header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body)).build(),
            HttpResponse.BodyHandlers.ofString(),
        )
        val token = runCatching {
            Json.parseToJsonElement(response.body()).jsonObject["data"]!!.jsonObject["login"]!!.jsonObject["accessToken"]!!.jsonPrimitive.content
        }.getOrNull()
        return token?.also { access = it } ?: throw ApiError(Kind.invalid, "Suwayomi refused the login with the username and password in server.json.")
    }
}
