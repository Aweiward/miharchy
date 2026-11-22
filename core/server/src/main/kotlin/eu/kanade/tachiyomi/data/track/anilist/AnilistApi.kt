// Ported from mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026
// app/src/main/java/eu/kanade/tachiyomi/data/track/anilist/AnilistApi.kt and AnilistUtils.kt, with the queries of
// app/src/main/graphql/mihon/graphql/anilist/*.graphql. Licensed under Apache-2.0.
// Changes: plain GraphQL requests over OkHttp instead of Apollo; java.time instead of kotlinx-datetime; no rate
// limiter (ponytail: AniList allows 90 requests a minute, and core sends a few per user action); Suwayomi's
// registered client, whose redirect leaves the callback in the address bar.

package eu.kanade.tachiyomi.data.track.anilist

import eu.kanade.tachiyomi.data.track.model.Track
import eu.kanade.tachiyomi.data.track.model.TrackSearch
import eu.kanade.tachiyomi.network.POST
import eu.kanade.tachiyomi.network.awaitSuccess
import eu.kanade.tachiyomi.network.jsonMime
import eu.kanade.tachiyomi.network.parseAs
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import org.jsoup.Jsoup
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

class AnilistApi(
    val trackerId: Long,
    val client: OkHttpClient,
    interceptor: AnilistInterceptor,
) {

    private val authClient = client.newBuilder()
        .addInterceptor(interceptor)
        .build()

    /** One GraphQL call; a reply with errors and no data is a failure. */
    private suspend fun graphql(query: String, variables: JsonObject = JsonObject(emptyMap())): JsonObject {
        val body = buildJsonObject {
            put("query", query)
            put("variables", variables)
        }
        val reply = authClient.newCall(POST(API_URL, body = body.toString().toRequestBody(jsonMime))).awaitSuccess().parseAs<JsonObject>()
        val data = reply["data"] as? JsonObject
        if (data == null) {
            val message = (reply["errors"] as? JsonArray)?.firstOrNull()?.jsonObject?.get("message")?.jsonPrimitive?.contentOrNull
            throw Exception("AniList: ${message ?: "no data"}")
        }
        return data
    }

    suspend fun addLibManga(track: Track): Track {
        val data = graphql(
            """
            mutation AniListAddManga(${'$'}manga_id: Int!, ${'$'}progress: Int!, ${'$'}status: MediaListStatus!, ${'$'}private: Boolean!) {
              SaveMediaListEntry(mediaId: ${'$'}manga_id, progress: ${'$'}progress, status: ${'$'}status, private: ${'$'}private) { id }
            }
            """.trimIndent(),
            buildJsonObject {
                put("manga_id", track.remote_id.toInt())
                put("progress", track.last_chapter_read.toInt())
                put("status", track.toApiStatus())
                put("private", track.private)
            },
        )
        val libraryId = data.obj("SaveMediaListEntry")?.int("id") ?: throw Exception("Failed to add manga")
        track.library_id = libraryId.toLong()
        return track
    }

    suspend fun updateLibManga(track: Track): Track {
        val libraryId = track.library_id
        requireNotNull(libraryId) { "AniList cannot update track with null library_id" }

        val data = graphql(
            """
            mutation AniListUpdateManga(${'$'}library_id: Int!, ${'$'}progress: Int!, ${'$'}status: MediaListStatus!, ${'$'}private: Boolean!,
              ${'$'}score: Int!, ${'$'}startedAt: FuzzyDateInput!, ${'$'}completedAt: FuzzyDateInput!) {
              SaveMediaListEntry(id: ${'$'}library_id, progress: ${'$'}progress, status: ${'$'}status, private: ${'$'}private,
                scoreRaw: ${'$'}score, startedAt: ${'$'}startedAt, completedAt: ${'$'}completedAt) { id }
            }
            """.trimIndent(),
            buildJsonObject {
                put("library_id", libraryId.toInt())
                put("progress", track.last_chapter_read.toInt())
                put("status", track.toApiStatus())
                put("private", track.private)
                put("score", track.score.toInt())
                put("startedAt", createFuzzyDate(track.started_reading_date))
                put("completedAt", createFuzzyDate(track.finished_reading_date))
            },
        )
        val remoteLibraryId = data.obj("SaveMediaListEntry")?.int("id") ?: throw Exception("Failed to update manga")
        track.library_id = remoteLibraryId.toLong()
        return track
    }

    suspend fun deleteLibManga(track: Track) {
        val libraryId = track.library_id
        requireNotNull(libraryId) { "AniList cannot delete track with null library_id" }
        val data = graphql(
            "mutation AniListDeleteManga(${'$'}library_id: Int!) { DeleteMediaListEntry(id: ${'$'}library_id) { deleted } }",
            buildJsonObject { put("library_id", libraryId.toInt()) },
        )
        data.obj("DeleteMediaListEntry") ?: throw Exception("Failed to delete manga")
    }

    suspend fun search(search: String): List<TrackSearch> {
        val data = graphql(
            """
            query AniListSearchManga(${'$'}search: String!) {
              Page(perPage: 50) { media(search: ${'$'}search, type: MANGA, format_not_in: [NOVEL]) { ...MangaFragment } }
            }
            $MANGA_FRAGMENT
            """.trimIndent(),
            buildJsonObject { put("search", search) },
        )
        return data.obj("Page")?.array("media").orEmpty().mapNotNull { (it as? JsonObject)?.toTrackSearch(trackerId) }
    }

    suspend fun findLibManga(track: Track, userId: Int): Track? {
        val data = graphql(
            """
            query AniListGetLibManga(${'$'}user_id: Int!, ${'$'}manga_id: Int!) {
              Page {
                mediaList(userId: ${'$'}user_id, type: MANGA, mediaId: ${'$'}manga_id) {
                  id status scoreRaw: score(format: POINT_100) progress private
                  startedAt { year month day } completedAt { year month day }
                  media { ...MangaFragment }
                }
              }
            }
            $MANGA_FRAGMENT
            """.trimIndent(),
            buildJsonObject {
                put("user_id", userId)
                put("manga_id", track.remote_id.toInt())
            },
        )
        return (data.obj("Page")?.array("mediaList")?.firstOrNull() as? JsonObject)?.toTrack(trackerId)
    }

    suspend fun getCurrentUser(): ALUser {
        val data = graphql("query AniListGetCurrentUser { Viewer { id name mediaListOptions { scoreFormat } } }")
        val viewer = data.obj("Viewer") ?: throw Exception("Failed to get AniList user data")
        return ALUser(
            id = viewer.int("id") ?: throw Exception("Failed to get AniList user data"),
            name = viewer.string("name").orEmpty(),
            scoreFormat = viewer.obj("mediaListOptions")?.string("scoreFormat") ?: Anilist.POINT_10_DECIMAL,
        )
    }

    suspend fun getMangaDetails(id: Int): TrackSearch? {
        val data = graphql(
            """
            query AniListGetMangaDetails(${'$'}manga_id: Int!) {
              Page(perPage: 1) { media(id: ${'$'}manga_id, type: MANGA, format_not_in: [NOVEL]) { ...MangaFragment } }
            }
            $MANGA_FRAGMENT
            """.trimIndent(),
            buildJsonObject { put("manga_id", id) },
        )
        return (data.obj("Page")?.array("media")?.firstOrNull() as? JsonObject)?.toTrackSearch(trackerId)
    }

    private fun createFuzzyDate(dateValue: Long): JsonObject {
        // all absent/null
        if (dateValue == 0L) return JsonObject(emptyMap())

        val date = Instant.ofEpochMilli(dateValue).atZone(ZoneId.systemDefault()).toLocalDate()
        return buildJsonObject {
            put("year", date.year)
            put("month", date.monthValue)
            put("day", date.dayOfMonth)
        }
    }

    companion object {
        // Suwayomi's registered client (Suwayomi-Server's AnilistApi), whose redirect leaves the callback in the address bar.
        private const val CLIENT_ID = "16186"
        const val API_URL = "https://graphql.anilist.co/"

        fun authUrl(): String = "https://anilist.co/api/v2/oauth/authorize".toHttpUrl().newBuilder()
            .addQueryParameter("client_id", CLIENT_ID)
            .addQueryParameter("response_type", "token")
            .build()
            .toString()

        private val MANGA_FRAGMENT = """
            fragment MangaFragment on Media {
              id
              staff { edges { role node { name { userPreferred } } } }
              title { userPreferred }
              coverImage { large }
              format
              countryOfOrigin
              status
              chapters
              description
              startDate { year month day }
              averageScore
            }
        """.trimIndent()
    }
}

// AnilistUtils.kt

private fun JsonObject.obj(k: String) = this[k] as? JsonObject
private fun JsonObject.array(k: String) = (this[k] as? JsonArray)
private fun JsonObject.string(k: String) = (this[k] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull
private fun JsonObject.int(k: String) = (this[k] as? kotlinx.serialization.json.JsonPrimitive)?.intOrNull

private fun fuzzyDate(date: JsonElement?): Long {
    val d = date as? JsonObject ?: return 0
    val year = d.int("year") ?: return 0
    val month = d.int("month") ?: return 0
    val day = d.int("day") ?: return 0
    return LocalDate.of(year, month, day).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()
}

internal fun JsonObject.toTrack(trackId: Long): Track {
    val mediaList = this
    val media = requireNotNull(mediaList.obj("media")) { "Missing Media data from AniList" }

    return media.toTrackSearch(trackId)
        .apply {
            library_id = mediaList.int("id")?.toLong()
            status = when (mediaList.string("status")) {
                "CURRENT" -> Anilist.READING
                "COMPLETED" -> Anilist.COMPLETED
                "PAUSED" -> Anilist.ON_HOLD
                "DROPPED" -> Anilist.DROPPED
                "PLANNING" -> Anilist.PLAN_TO_READ
                "REPEATING" -> Anilist.REREADING
                else -> throw Exception("Unknown status: ${mediaList.string("status")}")
            }
            score = (mediaList["scoreRaw"] as? kotlinx.serialization.json.JsonPrimitive)?.doubleOrNull ?: 0.0
            last_chapter_read = mediaList.int("progress")?.toDouble() ?: 0.0
            started_reading_date = fuzzyDate(mediaList["startedAt"])
            finished_reading_date = fuzzyDate(mediaList["completedAt"])
            private = (mediaList["private"] as? kotlinx.serialization.json.JsonPrimitive)?.booleanOrNull ?: false
        }
}

internal fun JsonObject.toTrackSearch(trackId: Long): TrackSearch {
    val alManga = this
    return TrackSearch.create(trackId).apply {
        remote_id = alManga.int("id")?.toLong() ?: 0
        title = alManga.obj("title")?.string("userPreferred") ?: "(no title)"
        total_chapters = alManga.int("chapters")?.toLong() ?: 0
        cover_url = alManga.obj("coverImage")?.string("large") ?: ""
        summary = alManga.string("description")?.let { Jsoup.parse(it).wholeText() } ?: ""
        score = alManga.int("averageScore")?.toDouble() ?: -1.0
        tracking_url = "https://anilist.co/manga/$remote_id"
        publishing_status = alManga.string("status") ?: ""
        val format = alManga.string("format")
        publishing_type = if (format == null) {
            "Manga"
        } else if (format != "MANGA") {
            format.replace("_", "-")
        } else {
            when (alManga.string("countryOfOrigin")) {
                "KR" -> "Manhwa"
                "CN", "TW" -> "Manhua"
                else -> "Manga"
            }
        }
        start_date = alManga.obj("startDate")?.let {
            buildString {
                it.int("year")?.let { year -> append(year) }
                it.int("month")?.let { month -> append("-$month") }
                it.int("day")?.let { day -> append("-$day") }
            }.trim('-')
        } ?: ""

        val edges = alManga.obj("staff")?.array("edges").orEmpty().mapNotNull { it as? JsonObject }
        authors = edges.filter { "Story" in (it.string("role") ?: "") }.mapNotNull { it.obj("node")?.obj("name")?.string("userPreferred") }
        artists = edges.filter { "Art" in (it.string("role") ?: "") }.mapNotNull { it.obj("node")?.obj("name")?.string("userPreferred") }
    }
}

internal fun Track.toApiStatus(): String = when (status) {
    Anilist.READING -> "CURRENT"
    Anilist.COMPLETED -> "COMPLETED"
    Anilist.ON_HOLD -> "PAUSED"
    Anilist.DROPPED -> "DROPPED"
    Anilist.PLAN_TO_READ -> "PLANNING"
    Anilist.REREADING -> "REPEATING"
    else -> throw Exception("Unknown status: $status")
}

internal fun Track.toApiScore(scoreType: String): String = when (scoreType) {
    // 10 point
    "POINT_10" -> (score.toInt() / 10).toString()
    // 100 point
    "POINT_100" -> score.toInt().toString()
    // 5 stars
    "POINT_5" -> when {
        score == 0.0 -> "0"
        score < 30 -> "1"
        score < 50 -> "2"
        score < 70 -> "3"
        score < 90 -> "4"
        else -> "5"
    }
    // Smiley
    "POINT_3" -> when {
        score == 0.0 -> "0"
        score <= 35 -> ":("
        score <= 60 -> ":|"
        else -> ":)"
    }
    // 10 point decimal
    "POINT_10_DECIMAL" -> (score / 10).toString()
    else -> throw Exception("Unknown score type")
}
