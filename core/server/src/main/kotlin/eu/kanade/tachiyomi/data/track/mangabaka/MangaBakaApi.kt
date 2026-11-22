// Ported from mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026
// app/src/main/java/eu/kanade/tachiyomi/data/track/mangabaka/MangaBakaApi.kt and dto/*.kt
// Licensed under Apache-2.0. Changes: okhttp3 HttpUrl instead of android Uri; java.time instead of kotlinx-datetime;
// no Dispatchers.IO hop (core's calls already run off the request threads); the User-Agent names Miharchy; no
// rate limiter (Mihon has none); Suwayomi's registered client and redirect, whose page shows the address the user
// pastes back (client id, redirect and scopes as in Suwayomi-Server's MangaBakaApi); no state parameter, as
// Suwayomi's login address has none; the PKCE verifier is kept in this instance, and the same one serves every
// authUrl until [endLogin].

package eu.kanade.tachiyomi.data.track.mangabaka

import eu.kanade.tachiyomi.data.track.model.Track
import eu.kanade.tachiyomi.data.track.model.TrackSearch
import eu.kanade.tachiyomi.network.DELETE
import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.network.HttpException
import eu.kanade.tachiyomi.network.POST
import eu.kanade.tachiyomi.network.PUT
import eu.kanade.tachiyomi.network.awaitSuccess
import eu.kanade.tachiyomi.network.jsonMime
import eu.kanade.tachiyomi.network.parseAs
import eu.kanade.tachiyomi.util.PkceCodes
import eu.kanade.tachiyomi.util.PkceUtil
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.FormBody
import okhttp3.Headers.Companion.headersOf
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import java.math.RoundingMode
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

class MangaBakaApi(
    private val trackerId: Long,
    baseClient: OkHttpClient,
    interceptor: MangaBakaInterceptor,
) {

    private val client = baseClient.newBuilder().addInterceptor {
        it.request().newBuilder()
            .header("User-Agent", USER_AGENT)
            .build()
            .let(it::proceed)
    }.build()

    private val authClient = client.newBuilder().addInterceptor(interceptor).build()

    private var pkce: PkceCodes? = null

    suspend fun addLibManga(track: Track): Track {
        val url = "$LIBRARY_API_URL/${track.remote_id}"
        val body = buildJsonObject {
            put("is_private", track.private)
            put("state", track.toApiStatus())
            if (track.last_chapter_read > 0.0) {
                put("progress_chapter", track.last_chapter_read)
            }
            if (track.score > 0) {
                put("rating", track.score.toInt().coerceIn(0, 100))
            }
            if (track.started_reading_date > 0) {
                put("start_date", track.started_reading_date.toLocalDate().toString())
            }
            if (track.finished_reading_date > 0) {
                put("finish_date", track.finished_reading_date.toLocalDate().toString())
            }
        }.toString().toRequestBody(jsonMime)

        authClient.newCall(POST(url, body = body)).awaitSuccess().close()

        // only returns 201 with the body { "status": 201, "data": true }, so no library ID for us
        return track
    }

    suspend fun deleteLibManga(track: Track) {
        val url = "$LIBRARY_API_URL/${track.remote_id}"

        authClient.newCall(DELETE(url)).awaitSuccess().close()
    }

    suspend fun findLibManga(track: Track): Track? {
        return try {
            val url = "$LIBRARY_API_URL/${track.remote_id}"
            val userData = authClient.newCall(GET(url))
                .awaitSuccess()
                .parseAs<MangaBakaListResult>()
                .data

            val additionalData = authClient.newCall(GET("$API_BASE_URL/v1/series/${track.remote_id}"))
                .awaitSuccess()
                .parseAs<MangaBakaItemResult>()
                .data

            Track.create(trackerId).apply {
                remote_id = track.remote_id
                title = additionalData.chooseBestTitle()
                status = userData.getStatus()
                score = userData.rating?.toDouble() ?: 0.0
                started_reading_date = parseIsoDateAsLocalStartOfDay(userData.startDate) ?: 0
                finished_reading_date = parseIsoDateAsLocalStartOfDay(userData.finishDate) ?: 0
                last_chapter_read = userData.progressChapter ?: 0.0
                private = userData.isPrivate
            }
        } catch (e: HttpException) {
            if (e.code == 404) {
                null
            } else {
                throw e
            }
        }
    }

    suspend fun updateLibManga(track: Track): Track {
        val url = "$LIBRARY_API_URL/${track.remote_id}"
        val body = buildJsonObject {
            put("state", track.toApiStatus())
            put("is_private", track.private)
            if (track.last_chapter_read > 0.0) {
                put("progress_chapter", track.last_chapter_read)
            } else {
                put("progress_chapter", null)
            }
            if (track.score > 0) {
                put("rating", track.score.toInt().coerceIn(0, 100))
            } else {
                put("rating", null)
            }
            if (track.started_reading_date > 0) {
                put("start_date", track.started_reading_date.toLocalDate().toString())
            } else {
                put("start_date", null)
            }
            if (track.finished_reading_date > 0) {
                put("finish_date", track.finished_reading_date.toLocalDate().toString())
            } else {
                put("finish_date", null)
            }
        }.toString().toRequestBody(jsonMime)

        authClient.newCall(PUT(url, body = body)).awaitSuccess().close()

        return track
    }

    suspend fun search(search: String): List<TrackSearch> {
        val url = "$API_BASE_URL/v1/series/search".toHttpUrl().newBuilder()
            .addQueryParameter("q", search)
            .addQueryParameter("type_not", "novel")
            .build()
        return client.newCall(GET(url))
            .awaitSuccess()
            .parseAs<MangaBakaSearchResult>()
            .data
            .map { parseSearchItem(it) }
    }

    private fun parseSearchItem(item: MangaBakaItem): TrackSearch {
        return TrackSearch.create(trackerId).apply {
            remote_id = item.id
            title = item.chooseBestTitle()
            summary = item.description?.trim().orEmpty()
            score = item.rating?.toBigDecimal()?.setScale(2, RoundingMode.HALF_UP)?.toDouble() ?: -1.0
            cover_url = item.cover.x250.x1.orEmpty()
            tracking_url = "$BASE_URL/${item.id}"
            start_date = item.published.startDate.orEmpty()
            publishing_status = item.status
            publishing_type = item.type.replaceFirstChar { c ->
                if (c.isLowerCase()) c.titlecase(Locale.getDefault()) else c.toString()
            }
            authors = item.authors.orEmpty()
            artists = item.artists.orEmpty()
        }
    }

    suspend fun getMangaDetails(id: Int): TrackSearch? {
        val url = "$API_BASE_URL/v1/series".toHttpUrl().newBuilder()
            .addPathSegment(id.toString())
            .build()
        return try {
            authClient.newCall(GET(url))
                .awaitSuccess()
                .parseAs<MangaBakaItemResult>()
                .data
                .let { parseSearchItem(it) }
        } catch (e: HttpException) {
            if (e.code == 404) {
                return null
            }
            throw e
        }
    }

    suspend fun getCurrentUser(): MangaBakaUserProfile {
        return authClient.newCall(GET("$API_BASE_URL/v1/my/profile"))
            .awaitSuccess()
            .parseAs<MangaBakaUserProfileResponse>()
            .data
    }

    suspend fun getAccessToken(code: String): MangaBakaOAuth {
        val verifier = synchronized(this) { pkce?.codeVerifier } ?: throw Exception("Open the MangaBaka login address first")
        val formBody = FormBody.Builder()
            .add("client_id", CLIENT_ID)
            .add("code", code)
            .add("code_verifier", verifier)
            .add("code_challenge_method", "S256")
            .add("grant_type", "authorization_code")
            .add("redirect_uri", REDIRECT_URI)
            .add("scope", SCOPES)
            .build()

        return client.newCall(POST("$OAUTH_URL/token", body = formBody))
            .awaitSuccess()
            .parseAs()
    }

    /**
     * The login address. The verifier is made on the first call and kept, so each later call (core asks
     * on every tracker.list) gives the same address, and the code the user brings back fits it.
     */
    @Synchronized
    fun authUrl(): String {
        // MangaBaka requires an actually conformant PKCE process, unlike MAL
        // 1. create verifier
        // 2. create challenge from verifier (S256 hash -> base64 URL encode)
        // 3. send challenge to /authorize
        // 4. send verifier for access tokens to /token
        val codes = pkce ?: PkceUtil.generateS256Codes().also { pkce = it }
        return "$OAUTH_URL/authorize".toHttpUrl().newBuilder()
            .addQueryParameter("client_id", CLIENT_ID)
            .addQueryParameter("code_challenge", codes.codeChallenge)
            .addQueryParameter("code_challenge_method", "S256")
            .addQueryParameter("response_type", "code")
            .addQueryParameter("scope", SCOPES)
            .addQueryParameter("redirect_uri", REDIRECT_URI)
            .build()
            .toString()
    }

    /** The login ended, by success or by logout: the next authUrl starts a new one. */
    @Synchronized
    fun endLogin() {
        pkce = null
    }

    private fun parseIsoDateAsLocalStartOfDay(isoDate: String?): Long? {
        // The v1 API returns full ISO 8601 strings with a midnight-UTC-truncated time component, regardless of the
        // actual time of the change made.
        return isoDate
            ?.substringBefore("T")
            ?.let { LocalDate.parse(it) }
            ?.atStartOfDay(ZoneId.systemDefault())
            ?.toInstant()
            ?.toEpochMilli()
    }

    private fun Long.toLocalDate(): LocalDate = Instant.ofEpochMilli(this).atZone(ZoneId.systemDefault()).toLocalDate()

    companion object {
        // Suwayomi's registered client (Suwayomi-Server's MangaBakaApi), not Mihon's.
        private const val CLIENT_ID = "XPHAGXckIvAkFyoJqgqDbRcaKdQgUTMK"

        private const val BASE_URL = "https://mangabaka.org"
        private const val API_BASE_URL = "https://api.mangabaka.org"
        private const val LIBRARY_API_URL = "$API_BASE_URL/v1/my/library"
        private const val OAUTH_URL = "$BASE_URL/auth/oauth2"
        private const val SCOPES = "library.read library.write offline_access openid"

        private const val REDIRECT_URI = "https://suwayomi.org/tracker-oauth"

        private const val USER_AGENT = "Miharchy"

        fun refreshTokenRequest(token: String) = POST(
            "$OAUTH_URL/token",
            headers = headersOf("User-Agent", USER_AGENT),
            body = FormBody.Builder()
                .add("grant_type", "refresh_token")
                .add("client_id", CLIENT_ID)
                .add("refresh_token", token)
                .add("redirect_uri", REDIRECT_URI)
                .build(),
        )
    }
}

private val TITLE_PRIORITIES = listOf("en", "ja-Latn", "ja", "ko-Latn", "ko", "zh-Latn", "zh")

@Serializable
data class MangaBakaItemResult(
    val data: MangaBakaItem,
)

@Serializable
data class MangaBakaSearchResult(
    val data: List<MangaBakaItem>,
)

@Serializable
data class MangaBakaItem(
    val id: Long,
    val cover: MangaBakaCover,
    val authors: List<String>?,
    val artists: List<String>?,
    val description: String?,
    val published: MangaBakaPublishData,
    val status: String,
    val type: String,
    val rating: Double?,
    val titles: List<MangaBakaItemTitle>?,
) {
    fun chooseBestTitle(): String {
        // based on https://mangabaka.org/pages/announcements/15-titles-v2#finding-the-title-you-want
        // extended with zh-Latn and zh
        val bestTitlePerLanguage = TITLE_PRIORITIES.associateWith { lang ->
            titles?.filter { it.language == lang }
                ?.minByOrNull {
                    when {
                        it.isPrimary -> 0
                        "official" in it.traits -> 1
                        "native" in it.traits -> 2
                        else -> 3
                    }
                }
        }
        return TITLE_PRIORITIES
            .firstNotNullOfOrNull { bestTitlePerLanguage[it]?.title }
            ?: titles?.firstOrNull()?.title
            ?: "ID: $id - Could not find name! (report on the MangaBaka Discord)"
    }
}

@Serializable
data class MangaBakaCover(
    val x250: MangaBakaScaledCover,
)

@Serializable
data class MangaBakaScaledCover(
    val x1: String?,
)

@Serializable
data class MangaBakaPublishData(
    @SerialName("start_date")
    val startDate: String?,
)

@Serializable
data class MangaBakaItemTitle(
    val language: String,
    val traits: List<String>,
    val title: String,
    @SerialName("is_primary")
    val isPrimary: Boolean,
)

@Serializable
data class MangaBakaListResult(
    val data: MangaBakaListEntry,
)

@Serializable
data class MangaBakaListEntry(
    val state: String,
    @SerialName("start_date")
    val startDate: String?,
    @SerialName("finish_date")
    val finishDate: String?,
    @SerialName("is_private")
    val isPrivate: Boolean,
    @SerialName("progress_chapter")
    val progressChapter: Double?,
    val rating: Long?,
) {
    fun getStatus(): Long = when (state) {
        "considering" -> MangaBaka.CONSIDERING
        "completed" -> MangaBaka.COMPLETED
        "dropped" -> MangaBaka.DROPPED
        "paused" -> MangaBaka.PAUSED
        "plan_to_read" -> MangaBaka.PLAN_TO_READ
        "reading" -> MangaBaka.READING
        "rereading" -> MangaBaka.REREADING
        else -> throw Exception("Unknown status: $state")
    }
}

@Serializable
data class MangaBakaUserProfileResponse(
    val data: MangaBakaUserProfile,
)

@Serializable
data class MangaBakaUserProfile(
    // incomplete DTO since this is the only part we need
    val id: String,
    @SerialName("rating_steps")
    val ratingSteps: Int,
    val nickname: String?,
    @SerialName("preferred_username")
    val preferredUsername: String?,
)
