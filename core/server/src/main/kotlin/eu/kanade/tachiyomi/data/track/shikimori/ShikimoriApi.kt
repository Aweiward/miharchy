// Ported from mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026
// app/src/main/java/eu/kanade/tachiyomi/data/track/shikimori/ShikimoriApi.kt and ShikimoriUtils.kt, with the queries of
// app/src/main/graphql/mihon/graphql/shikimori/*.graphql. Licensed under Apache-2.0.
// Changes: plain GraphQL requests over OkHttp instead of Apollo; okhttp3.HttpUrl instead of Android's Uri; no rate
// limiter (ponytail: Shikimori allows 5 requests a second and 90 a minute, and core sends a few per user action);
// Suwayomi's registered client, secret and redirect (Suwayomi-Server's ShikimoriApi), whose redirect leaves the callback in the address bar.

package eu.kanade.tachiyomi.data.track.shikimori

import eu.kanade.tachiyomi.data.track.model.Track
import eu.kanade.tachiyomi.data.track.model.TrackSearch
import eu.kanade.tachiyomi.network.DELETE
import eu.kanade.tachiyomi.network.POST
import eu.kanade.tachiyomi.network.PUT
import eu.kanade.tachiyomi.network.awaitSuccess
import eu.kanade.tachiyomi.network.jsonMime
import eu.kanade.tachiyomi.network.parseAs
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import okhttp3.FormBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody

class ShikimoriApi(
    private val trackerId: Long,
    private val client: OkHttpClient,
    interceptor: ShikimoriInterceptor,
) {

    private val authClient = client.newBuilder().addInterceptor(interceptor).build()

    /** One GraphQL call; a reply with errors and no data is a failure. */
    private suspend fun graphql(query: String, variables: JsonObject = JsonObject(emptyMap())): JsonObject {
        val body = buildJsonObject {
            put("query", query)
            put("variables", variables)
        }
        val reply = authClient.newCall(POST("$API_URL/graphql", body = body.toString().toRequestBody(jsonMime))).awaitSuccess().parseAs<JsonObject>()
        val data = reply["data"] as? JsonObject
        if (data == null) {
            val message = ((reply["errors"] as? JsonArray)?.firstOrNull() as? JsonObject)?.get("message")?.jsonPrimitive?.contentOrNull
            throw Exception("Shikimori: ${message ?: "no data"}")
        }
        return data
    }

    suspend fun addLibManga(track: Track, userId: String): Track {
        val payload = buildJsonObject {
            putJsonObject("user_rate") {
                put("user_id", userId)
                put("target_id", track.remote_id)
                put("target_type", "Manga")
                put("chapters", track.last_chapter_read.toInt())
                put("score", track.score.toInt())
                put("status", track.toShikimoriStatus())
            }
        }
        authClient.newCall(POST("$API_URL/v2/user_rates", body = payload.toString().toRequestBody(jsonMime)))
            .awaitSuccess()
            .parseAs<SMLibraryIdResponse>()
            .let {
                // save id of the entry for possible future delete request
                track.library_id = it.id
            }
        return track
    }

    suspend fun updateLibManga(track: Track): Track {
        val payload = buildJsonObject {
            putJsonObject("user_rate") {
                put("chapters", track.last_chapter_read.toInt())
                put("score", track.score.toInt())
                put("status", track.toShikimoriStatus())
            }
        }
        authClient.newCall(PUT("$API_URL/v2/user_rates/${track.library_id}", body = payload.toString().toRequestBody(jsonMime)))
            .awaitSuccess()
            .parseAs<SMLibraryIdResponse>()
            .let {
                track.library_id = it.id
            }
        return track
    }

    suspend fun deleteLibManga(track: Track) {
        authClient.newCall(DELETE("$API_URL/v2/user_rates/${track.library_id}")).awaitSuccess().close()
    }

    suspend fun search(search: String): List<TrackSearch> {
        val data = graphql(
            """
            query ShikimoriSearchManga(${'$'}search: String!) {
              mangas(search: ${'$'}search, limit: 20, kind: "!light_novel,!novel") { ...MangaFragment }
            }
            $MANGA_FRAGMENT
            """.trimIndent(),
            buildJsonObject { put("search", search) },
        )
        return data.mangas().map { it.toTrackSearch(trackerId) }
    }

    suspend fun getMangaDetails(id: Int): TrackSearch? {
        val data = graphql(
            """
            query ShikimoriGetMangaDetails(${'$'}query: String!) {
              mangas(ids: ${'$'}query, limit: 1, kind: "!light_novel,!novel") { ...MangaFragment }
            }
            $MANGA_FRAGMENT
            """.trimIndent(),
            buildJsonObject { put("query", "$id") },
        )
        return data.mangas().firstOrNull()?.toTrackSearch(trackerId)
    }

    suspend fun findLibManga(track: Track): Track? {
        val data = graphql(
            """
            query ShikimoriGetLibManga(${'$'}remote_id: String!) {
              mangas(ids: ${'$'}remote_id, limit: 1) { id url name chapters userRate { id chapters status score } }
            }
            """.trimIndent(),
            buildJsonObject { put("remote_id", track.remote_id.toString()) },
        )
        // Shikimori has no user list query that allows query by ID, so we go via the "mangas" query & include
        // userRate data which will be null if the title is not in the user's list.
        // If it was removed on Shikimori and is still linked in the app, notify user via returning null here
        // which throws an exception at the Shikimori.refresh call
        val manga = data.mangas().firstOrNull() ?: return null
        if (manga.obj("userRate") == null) return null
        return manga.toTrack(trackerId)
    }

    suspend fun getCurrentUser(): SMUser {
        val data = graphql("query ShikimoriGetCurrentUser { currentUser { id nickname } }")
        val user = data.obj("currentUser") ?: throw Exception("Failed to get Shikimori user data")
        return SMUser(
            id = user.string("id") ?: throw Exception("Failed to get Shikimori user data"),
            nickname = user.string("nickname").orEmpty(),
        )
    }

    /** The code grant. Its reply is the token, so nothing of it goes into an error message. */
    suspend fun accessToken(code: String): SMOAuth {
        return client.newCall(accessTokenRequest(code)).awaitSuccess().parseAs()
    }

    private fun accessTokenRequest(code: String) = POST(
        OAUTH_URL,
        body = FormBody.Builder()
            .add("grant_type", "authorization_code")
            .add("client_id", CLIENT_ID)
            .add("client_secret", CLIENT_SECRET)
            .add("code", code)
            .add("redirect_uri", REDIRECT_URL)
            .build(),
    )

    companion object {
        private const val BASE_URL = "https://shikimori.io"
        private const val API_URL = "$BASE_URL/api"
        private const val OAUTH_URL = "$BASE_URL/oauth/token"
        private const val LOGIN_URL = "$BASE_URL/oauth/authorize"

        // Suwayomi's registered client (Suwayomi-Server's ShikimoriApi), whose redirect leaves the callback in the address bar.
        private const val REDIRECT_URL = "https://suwayomi.org/tracker-oauth"

        private const val CLIENT_ID = "qTrMBF5HtM_33Pv2Vm2fFmEaBUI_c3LvohyJ0beQ9pA"
        private const val CLIENT_SECRET = "MN_XHQK_aeSqduW_rB64cARi2fFoLGl-AgZ0iMD9zq0"

        fun authUrl(): String = LOGIN_URL.toHttpUrl().newBuilder()
            .addQueryParameter("client_id", CLIENT_ID)
            .addQueryParameter("redirect_uri", REDIRECT_URL)
            .addQueryParameter("response_type", "code")
            .build()
            .toString()

        fun refreshTokenRequest(token: String) = POST(
            OAUTH_URL,
            body = FormBody.Builder()
                .add("grant_type", "refresh_token")
                .add("client_id", CLIENT_ID)
                .add("client_secret", CLIENT_SECRET)
                .add("refresh_token", token)
                .build(),
        )

        private val MANGA_FRAGMENT = """
            fragment MangaFragment on Manga {
              id
              name
              chapters
              kind
              poster { mainUrl }
              score
              url
              status
              airedOn { date }
              description
              personRoles { person { name } rolesEn }
            }
        """.trimIndent()
    }
}

// ShikimoriUtils.kt

private fun JsonObject.obj(k: String) = this[k] as? JsonObject
private fun JsonObject.prim(k: String) = (this[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }
private fun JsonObject.string(k: String) = prim(k)?.contentOrNull
private fun JsonObject.mangas() = (this["mangas"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }

internal fun JsonObject.toTrack(trackId: Long): Track {
    val sManga = this
    return Track.create(trackId).apply {
        remote_id = sManga.string("id")?.toLongOrNull() ?: 0
        title = sManga.string("name").orEmpty()
        total_chapters = sManga.prim("chapters")?.intOrNull?.toLong() ?: 0
        tracking_url = sManga.string("url").orEmpty()

        val userRate = sManga.obj("userRate")
        if (userRate != null) {
            // null if not in user's list, must not throw here because it'd break adding titles
            // throws in the findLibManga method of ShikimoriApi if null and shouldn't be
            library_id = userRate.string("id")?.toLongOrNull()
            last_chapter_read = userRate.prim("chapters")?.doubleOrNull ?: 0.0
            score = userRate.prim("score")?.doubleOrNull ?: 0.0
            status = userRate.string("status").toLocalStatus()
        }
    }
}

internal fun JsonObject.toTrackSearch(trackId: Long): TrackSearch {
    val sManga = this
    return TrackSearch.create(trackId).apply {
        remote_id = sManga.string("id")?.toLongOrNull() ?: 0
        title = sManga.string("name").orEmpty()
        total_chapters = sManga.prim("chapters")?.intOrNull?.toLong() ?: 0
        cover_url = sManga.obj("poster")?.string("mainUrl").orEmpty()
        summary = sManga.string("description").orEmpty()
        score = sManga.prim("score")?.doubleOrNull?.takeIf { it > 0.0 } ?: -1.0
        tracking_url = sManga.string("url").orEmpty()
        publishing_status = sManga.string("status").statusName()
        publishing_type = sManga.string("kind").kindName()
        start_date = sManga.obj("airedOn")?.string("date").orEmpty()
        val roles = (sManga["personRoles"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }
        fun named(role: String) = roles
            .filter { r -> (r["rolesEn"] as? JsonArray).orEmpty().any { it.jsonPrimitive.content.contains(role) } }
            .mapNotNull { it.obj("person")?.string("name") }
        authors = named("Story")
        artists = named("Art")
    }
}

private fun String?.kindName() = when (this) {
    "manga" -> "Manga"
    "manhwa" -> "Manhwa"
    "manhua" -> "Manhua"
    "one_shot" -> "Oneshot"
    "doujin" -> "Doujin"
    // light novel & novel omitted by query filter, fall back to empty if included
    else -> ""
}

private fun String?.statusName() = when (this) {
    "anons" -> "Planned"
    "ongoing" -> "Ongoing"
    "released" -> "Released"
    "paused" -> "Paused"
    "discontinued" -> "Discontinued"
    else -> ""
}

private fun String?.toLocalStatus(): Long = when (this) {
    "planned" -> Shikimori.PLAN_TO_READ
    "watching" -> Shikimori.READING
    "rewatching" -> Shikimori.REREADING
    "completed" -> Shikimori.COMPLETED
    "on_hold" -> Shikimori.ON_HOLD
    "dropped" -> Shikimori.DROPPED
    else -> throw Exception("Unknown status: $this")
}

internal fun Track.toShikimoriStatus(): String = when (status) {
    // Shikimori has no GraphQL mutations, so this goes through the v2 API
    Shikimori.READING -> "watching"
    Shikimori.COMPLETED -> "completed"
    Shikimori.ON_HOLD -> "on_hold"
    Shikimori.DROPPED -> "dropped"
    Shikimori.PLAN_TO_READ -> "planned"
    Shikimori.REREADING -> "rewatching"
    else -> throw Exception("Unknown status: $status")
}
