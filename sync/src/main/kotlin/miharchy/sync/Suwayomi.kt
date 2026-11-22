package miharchy.sync

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// What core's move (core/server/.../Move.kt) needs to read a Suwayomi install: server.json and the token check.

/** Suwayomi's v1.1.1 server.json. */
@Serializable
data class ServerConfig(val url: String, val username: String, val password: String)

/**
 * Whether Suwayomi refused the access token: under ui_login, GraphQL answers a missing or expired one with 200 and an
 * `Unauthorized` error, a file request with 401.
 */
fun refusedToken(status: Int, body: String): Boolean = status == 401 || status == 200 && runCatching {
    Json.parseToJsonElement(body).jsonObject["errors"]?.jsonArray?.firstOrNull()?.jsonObject?.get("message")?.jsonPrimitive?.content?.lineSequence()?.first()?.endsWith(" : Unauthorized")
}.getOrNull() == true
