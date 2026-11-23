// Ported from mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026
// app/src/main/java/eu/kanade/tachiyomi/data/track/kitsu/KitsuApi.kt and KitsuUtils.kt, with the queries of
// app/src/main/graphql/mihon/graphql/kitsu/*.graphql. Licensed under Apache-2.0.
// Changes: plain GraphQL requests over OkHttp instead of Apollo; java.time instead of kotlinx-datetime; no rate
// limiter (Mihon has none for Kitsu); Suwayomi's registered client id and secret (Suwayomi-Server's KitsuApi,
// where they are Mihon's too). Search is Mihon's searchMangaByTitle query: the pinned commit has no Algolia call.

package eu.kanade.tachiyomi.data.track.kitsu

import eu.kanade.tachiyomi.data.track.model.Track
import eu.kanade.tachiyomi.data.track.model.TrackSearch
import eu.kanade.tachiyomi.network.HttpException
import eu.kanade.tachiyomi.network.POST
import eu.kanade.tachiyomi.network.await
import eu.kanade.tachiyomi.network.awaitSuccess
import eu.kanade.tachiyomi.network.jsonMime
import eu.kanade.tachiyomi.network.parseAs
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import java.time.Instant
import java.time.OffsetDateTime

class KitsuApi(
    private val trackerId: Long,
    private val client: OkHttpClient,
    interceptor: KitsuInterceptor,
) {

    private val authClient = client.newBuilder().addInterceptor(interceptor).build()

    /** One GraphQL call; a reply with errors and no data is a failure. */
    private suspend fun graphql(query: String, variables: JsonObject = JsonObject(emptyMap())): JsonObject {
        val body = buildJsonObject {
            put("query", query)
            put("variables", variables)
        }
        val reply = authClient.newCall(POST(GRAPHQL_URL, body = body.toString().toRequestBody(jsonMime))).awaitSuccess().parseAs<JsonObject>()
        return graphqlData(reply)
    }

    private fun graphqlData(reply: JsonObject): JsonObject {
        val data = reply["data"] as? JsonObject
        if (data == null) {
            val message = (reply["errors"] as? JsonArray)?.firstOrNull()?.jsonObject?.get("message")?.jsonPrimitive?.contentOrNull
            throw Exception("Kitsu: ${message ?: "no data"}")
        }
        return data
    }

    suspend fun addLibManga(track: Track): Track {
        val data = graphql(
            """
            mutation KitsuAddLibManga(${'$'}media_id: ID!, ${'$'}status: LibraryEntryStatusEnum!, ${'$'}progress: Int!, ${'$'}private: Boolean!, ${'$'}rating: Int) {
              libraryEntry {
                create(input: { mediaId: ${'$'}media_id, mediaType: MANGA, status: ${'$'}status, progress: ${'$'}progress, private: ${'$'}private, rating: ${'$'}rating }) {
                  errors { message }
                  libraryEntry { id }
                }
              }
            }
            """.trimIndent(),
            buildJsonObject {
                put("media_id", track.remote_id.toString())
                put("status", track.toKitsuStatus())
                put("progress", track.last_chapter_read.toInt())
                put("private", track.private)
                put("rating", track.score.toInt().takeIf { it > 0 })
            },
        )
        val libraryId = data.obj("libraryEntry")?.obj("create")?.obj("libraryEntry")?.string("id")?.toLongOrNull()
            ?: throw Exception("Failed to add manga")
        track.library_id = libraryId
        return track
    }

    suspend fun updateLibManga(track: Track): Track {
        val libraryId = track.library_id
        requireNotNull(libraryId) { "Kitsu cannot update track with null library_id" }

        val data = graphql(
            """
            mutation KitsuUpdateLibManga(${'$'}library_id: ID!, ${'$'}status: LibraryEntryStatusEnum!, ${'$'}progress: Int!, ${'$'}private: Boolean!,
              ${'$'}rating: Int, ${'$'}startedAt: ISO8601DateTime, ${'$'}finishedAt: ISO8601DateTime) {
              libraryEntry {
                update(input: { id: ${'$'}library_id, status: ${'$'}status, progress: ${'$'}progress, private: ${'$'}private, rating: ${'$'}rating,
                  startedAt: ${'$'}startedAt, finishedAt: ${'$'}finishedAt }) {
                  errors { message }
                  libraryEntry { id }
                }
              }
            }
            """.trimIndent(),
            buildJsonObject {
                put("library_id", libraryId.toString())
                put("status", track.toKitsuStatus())
                put("progress", track.last_chapter_read.toInt())
                put("private", track.private)
                put("rating", track.score.toInt().takeIf { it > 0 })
                put("startedAt", track.started_reading_date.takeIf { it > 0 }?.let { Instant.ofEpochMilli(it).toString() })
                put("finishedAt", track.finished_reading_date.takeIf { it > 0 }?.let { Instant.ofEpochMilli(it).toString() })
            },
        )
        track.library_id = data.obj("libraryEntry")?.obj("update")?.obj("libraryEntry")?.string("id")?.toLongOrNull()
            ?: throw Exception("Failed to update manga")
        return track
    }

    suspend fun removeLibManga(track: Track) {
        val libraryId = track.library_id
        requireNotNull(libraryId) { "Kitsu cannot delete track with null library_id" }

        val body = buildJsonObject {
            put(
                "query",
                """
                mutation KitsuDeleteLibEntry(${'$'}library_id: ID!) {
                  libraryEntry { delete(input: { id: ${'$'}library_id }) { errors { message } libraryEntry { id } } }
                }
                """.trimIndent(),
            )
            put("variables", buildJsonObject { put("library_id", libraryId.toString()) })
        }
        authClient.newCall(POST(GRAPHQL_URL, body = body.toString().toRequestBody(jsonMime))).await().use { response ->
            if (response.isSuccessful) return
            // Deleting something not in the library returns a 500 with a "Couldn't find LibraryEntry" message;
            // the user gets their wish of "title not in library", so that is not an error.
            if (response.code == 500 && response.body.string().contains("Couldn't find LibraryEntry with 'id'=")) return
            throw HttpException(response.code)
        }
    }

    suspend fun search(search: String): List<TrackSearch> {
        val data = graphql(
            """
            query KitsuSearchMangaByTitle(${'$'}query: String!) {
              searchMangaByTitle(title: ${'$'}query, first: 20) { nodes { ...MangaFragment } }
            }
            $MANGA_FRAGMENT
            """.trimIndent(),
            buildJsonObject { put("query", search) },
        )
        return data.obj("searchMangaByTitle")?.array("nodes").orEmpty()
            .mapNotNull { it as? JsonObject }
            .filterNot { it.string("subtype") == "NOVEL" }
            .map { it.toTrackSearch(trackerId) }
    }

    suspend fun findLibManga(track: Track): Track? {
        val data = graphql(
            """
            query KitsuFindLibManga(${'$'}remote_id: ID!) {
              findMangaById(id: ${'$'}remote_id) {
                ...MangaFragment
                myLibraryEntry { id private progress rating status startedAt finishedAt }
              }
            }
            $MANGA_FRAGMENT
            """.trimIndent(),
            buildJsonObject { put("remote_id", track.remote_id.toString()) },
        )
        return data.obj("findMangaById")?.toLibraryTrack(trackerId)
    }

    /** The password grant. Its reply is the token, so nothing of it goes into an error message. */
    suspend fun login(username: String, password: String): KitsuOAuth {
        val formBody = FormBody.Builder()
            .add("username", username)
            .add("password", password)
            .add("grant_type", "password")
            .add("client_id", CLIENT_ID)
            .add("client_secret", CLIENT_SECRET)
            .build()
        return client.newCall(POST(LOGIN_URL, body = formBody)).awaitSuccess().parseAs()
    }

    suspend fun getCurrentUser(): KitsuUser {
        val data = graphql("query KitsuGetCurrentAccount { currentAccount { id ratingSystem profile { name } } }")
        val account = data.obj("currentAccount") ?: throw Exception("Failed to get Kitsu user data")
        return KitsuUser(
            id = account.string("id") ?: throw Exception("Failed to get Kitsu user data"),
            name = account.obj("profile")?.string("name").orEmpty(),
            ratingSystem = account.string("ratingSystem").orEmpty(),
        )
    }

    suspend fun getMangaDetails(search: String): TrackSearch? {
        // An all-digit search is an id, anything else a slug.
        val data = if (search.matches(Regex("\\d+"))) {
            graphql(
                """
                query KitsuGetMangaDetailsById(${'$'}id: ID!) { findMangaById(id: ${'$'}id) { ...MangaFragment } }
                $MANGA_FRAGMENT
                """.trimIndent(),
                buildJsonObject { put("id", search) },
            ).obj("findMangaById")
        } else {
            graphql(
                """
                query KitsuGetMangaDetailsBySlug(${'$'}slug: String!) { findMangaBySlug(slug: ${'$'}slug) { ...MangaFragment } }
                $MANGA_FRAGMENT
                """.trimIndent(),
                buildJsonObject { put("slug", search) },
            ).obj("findMangaBySlug")
        }
        return data?.toTrackSearch(trackerId)
    }

    companion object {
        // Mihon's registered client, as Suwayomi-Server's KitsuApi has it; the password grant has no redirect.
        private const val CLIENT_ID = "dd031b32d2f56c990b1425efe6c42ad847e7fe3ab46bf1299f05ecd856bdb7dd"
        private const val CLIENT_SECRET = "54d7307928f63414defd96399fc31ba847961ceaecef3a5fd93144e960c0e151"

        const val GRAPHQL_URL = "https://kitsu.app/api/graphql"
        const val LOGIN_URL = "https://kitsu.app/api/oauth/token"

        fun refreshTokenRequest(token: String) = POST(
            LOGIN_URL,
            body = FormBody.Builder()
                .add("grant_type", "refresh_token")
                .add("refresh_token", token)
                .add("client_id", CLIENT_ID)
                .add("client_secret", CLIENT_SECRET)
                .build(),
        )

        private val MANGA_FRAGMENT = """
            fragment MangaFragment on Manga {
              id
              titles { preferred }
              chapterCount
              staff(first: 5) { nodes { role person { name } } }
              posterImage { views(names: "small") { name url } original { name url } }
              description(locales: "en")
              status
              subtype
              startDate
              slug
              averageRating
            }
        """.trimIndent()
    }
}

// KitsuUtils.kt

private fun JsonObject.obj(k: String) = this[k] as? JsonObject
private fun JsonObject.array(k: String) = this[k] as? JsonArray
private fun JsonObject.prim(k: String) = (this[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }
private fun JsonObject.string(k: String) = prim(k)?.contentOrNull

internal fun Track.toKitsuStatus(): String = when (status) {
    Kitsu.READING -> "CURRENT"
    Kitsu.PLAN_TO_READ -> "PLANNED"
    Kitsu.COMPLETED -> "COMPLETED"
    Kitsu.ON_HOLD -> "ON_HOLD"
    Kitsu.DROPPED -> "DROPPED"
    else -> throw Exception("Unknown status: $status")
}

private fun String?.toLocalStatus(): Long = when (this) {
    "CURRENT" -> Kitsu.READING
    "PLANNED" -> Kitsu.PLAN_TO_READ
    "COMPLETED" -> Kitsu.COMPLETED
    "ON_HOLD" -> Kitsu.ON_HOLD
    "DROPPED" -> Kitsu.DROPPED
    else -> throw Exception("Unknown status: $this")
}

private fun String.capitalized() = lowercase().replaceFirstChar { it.uppercase() }

/** A manga with its `myLibraryEntry`, or null when the manga is not on the user's list. */
internal fun JsonObject.toLibraryTrack(trackId: Long): TrackSearch? {
    val entry = obj("myLibraryEntry") ?: return null
    return toTrackSearch(trackId).apply {
        library_id = entry.string("id")?.toLongOrNull() ?: throw Exception("Missing library entry id from Kitsu")
        started_reading_date = entry.string("startedAt")?.let { OffsetDateTime.parse(it).toInstant().toEpochMilli() } ?: 0
        finished_reading_date = entry.string("finishedAt")?.let { OffsetDateTime.parse(it).toInstant().toEpochMilli() } ?: 0
        status = entry.string("status").toLocalStatus()
        score = entry.prim("rating")?.doubleOrNull ?: 0.0
        last_chapter_read = entry.prim("progress")?.doubleOrNull ?: 0.0
        private = entry.prim("private")?.booleanOrNull ?: false
    }
}

internal fun JsonObject.toTrackSearch(trackId: Long): TrackSearch {
    val kitsuManga = this
    return TrackSearch.create(trackId).apply {
        remote_id = kitsuManga.string("id")?.toLongOrNull() ?: 0
        title = kitsuManga.obj("titles")?.string("preferred").orEmpty()
        total_chapters = kitsuManga.prim("chapterCount")?.intOrNull?.toLong() ?: 0
        val poster = kitsuManga.obj("posterImage")
        cover_url = (poster?.array("views")?.firstOrNull() as? JsonObject)?.string("url") ?: poster?.obj("original")?.string("url").orEmpty()
        summary = kitsuManga.obj("description")?.string("en").orEmpty()
        tracking_url = "https://kitsu.app/manga/${kitsuManga.string("slug")}"
        score = kitsuManga.prim("averageRating")?.doubleOrNull ?: -1.0
        publishing_status = kitsuManga.string("status")?.let { if (it == "TBA") it else it.capitalized() }.orEmpty()
        publishing_type = kitsuManga.string("subtype")?.let { if (it == "OEL") it else it.capitalized() }.orEmpty()
        start_date = kitsuManga.string("startDate").orEmpty()
        val staff = kitsuManga.obj("staff")?.array("nodes").orEmpty().mapNotNull { it as? JsonObject }
        authors = staff.filter { it.string("role").orEmpty().contains("Story") }.mapNotNull { it.obj("person")?.string("name") }
        artists = staff.filter { it.string("role").orEmpty().contains("Art") }.mapNotNull { it.obj("person")?.string("name") }
    }
}
