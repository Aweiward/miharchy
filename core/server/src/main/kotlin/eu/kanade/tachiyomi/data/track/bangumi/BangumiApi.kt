// Ported from mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026
// app/src/main/java/eu/kanade/tachiyomi/data/track/bangumi/BangumiApi.kt and dto/BGMCollectionResponse.kt,
// dto/BGMSearch.kt. Licensed under Apache-2.0.
// Changes: okhttp3 HttpUrl instead of android Uri; no Dispatchers.IO hop (core's calls already run off the
// request threads); Suwayomi's registered client, whose redirect page shows the address the user pastes back
// (client id, secret and redirect as in Suwayomi-Server's BangumiApi); no rate limiter (Mihon has none).

package eu.kanade.tachiyomi.data.track.bangumi

import eu.kanade.tachiyomi.data.track.model.Track
import eu.kanade.tachiyomi.data.track.model.TrackSearch
import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.network.HttpException
import eu.kanade.tachiyomi.network.PATCH
import eu.kanade.tachiyomi.network.POST
import eu.kanade.tachiyomi.network.awaitSuccess
import eu.kanade.tachiyomi.network.jsonMime
import eu.kanade.tachiyomi.network.parseAs
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import okhttp3.CacheControl
import okhttp3.FormBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody

class BangumiApi(
    private val trackerId: Long,
    private val client: OkHttpClient,
    interceptor: BangumiInterceptor,
) {

    private val authClient = client.newBuilder().addInterceptor(interceptor).build()

    private fun libBody(track: Track) = buildJsonObject {
        put("type", track.toApiStatus())
        put("rate", track.score.toInt().coerceIn(0, 10))
        put("ep_status", track.last_chapter_read.toInt())
        put("private", track.private)
    }.toString().toRequestBody(jsonMime)

    suspend fun addLibManga(track: Track): Track {
        val url = "$API_URL/v0/users/-/collections/${track.remote_id}"
        // Returns with 202 Accepted on success with no body
        authClient.newCall(POST(url, body = libBody(track))).awaitSuccess().close()
        return track
    }

    suspend fun updateLibManga(track: Track): Track {
        val url = "$API_URL/v0/users/-/collections/${track.remote_id}"
        // Returns with 204 No Content
        authClient.newCall(PATCH(url, body = libBody(track))).awaitSuccess().close()
        return track
    }

    suspend fun search(search: String): List<TrackSearch> {
        // This API is marked as experimental in the documentation
        // but that has been the case since 2022 with few significant
        // changes to the schema for this endpoint since
        // "实验性 API， 本 schema 和实际的 API 行为都可能随时发生改动"
        val url = "$API_URL/v0/search/subjects?limit=20"
        val body = buildJsonObject {
            put("keyword", search)
            put("sort", "match")
            putJsonObject("filter") {
                putJsonArray("type") {
                    add(1) // "Book" (书籍) type
                }
            }
        }.toString().toRequestBody(jsonMime)
        return authClient.newCall(POST(url, body = body))
            .awaitSuccess()
            .parseAs<BGMSearchResult>()
            .data
            .filter { it.platform == null || it.platform == "漫画" }
            .map { it.toTrackSearch(trackerId) }
    }

    suspend fun getMangaDetails(id: Int): TrackSearch? {
        val url = "$API_URL/v0/subjects/$id"
        return authClient.newCall(GET(url))
            .awaitSuccess()
            .parseAs<BGMSubject>()
            .takeIf { it.platform == null || it.platform == "漫画" }
            ?.toTrackSearch(trackerId)
    }

    suspend fun statusLibManga(track: Track, username: String): Track? {
        val url = "$API_URL/v0/users/$username/collections/${track.remote_id}"
        return try {
            authClient.newCall(GET(url, cache = CacheControl.FORCE_NETWORK))
                .awaitSuccess()
                .parseAs<BGMCollectionResponse>()
                .let {
                    track.status = it.getStatus()
                    track.last_chapter_read = it.epStatus?.toDouble() ?: 0.0
                    track.score = it.rate?.toDouble() ?: 0.0
                    track.total_chapters = it.subject?.eps?.toLong() ?: 0L
                    track
                }
        } catch (e: HttpException) {
            if (e.code == 404) { // "subject is not collected by user"
                null
            } else {
                throw e
            }
        }
    }

    suspend fun accessToken(code: String): BGMOAuth {
        val body = FormBody.Builder()
            .add("grant_type", "authorization_code")
            .add("client_id", CLIENT_ID)
            .add("client_secret", CLIENT_SECRET)
            .add("code", code)
            .add("redirect_uri", REDIRECT_URL)
            .build()
        return client.newCall(POST(OAUTH_URL, body = body))
            .awaitSuccess()
            .parseAs<BGMOAuth>()
    }

    suspend fun getCurrentUser(): BGMUser {
        return authClient.newCall(GET("$API_URL/v0/me"))
            .awaitSuccess()
            .parseAs<BGMUser>()
    }

    companion object {
        // Suwayomi's registered client (Suwayomi-Server's BangumiApi), not Mihon's.
        private const val CLIENT_ID = "bgm376667faf473119bb"
        private const val CLIENT_SECRET = "d74caf0b874ddd18e6c6e7fb86d77a06"

        private const val API_URL = "https://api.bgm.tv"
        private const val OAUTH_URL = "https://bgm.tv/oauth/access_token"
        private const val LOGIN_URL = "https://bgm.tv/oauth/authorize"

        private const val REDIRECT_URL = "https://suwayomi.org/tracker-oauth"

        fun authUrl(): String = LOGIN_URL.toHttpUrl().newBuilder()
            .addQueryParameter("client_id", CLIENT_ID)
            .addQueryParameter("response_type", "code")
            .addQueryParameter("redirect_uri", REDIRECT_URL)
            .build()
            .toString()

        fun refreshTokenRequest(token: String) = POST(
            OAUTH_URL,
            body = FormBody.Builder()
                .add("grant_type", "refresh_token")
                .add("client_id", CLIENT_ID)
                .add("client_secret", CLIENT_SECRET)
                .add("refresh_token", token)
                .add("redirect_uri", REDIRECT_URL)
                .build(),
        )
    }
}

@Serializable
// Incomplete DTO with only our needed attributes
data class BGMCollectionResponse(
    val rate: Int?,
    val type: Int?,
    @SerialName("ep_status")
    val epStatus: Int? = 0,
    @SerialName("vol_status")
    val volStatus: Int? = 0,
    val private: Boolean = false,
    val subject: BGMSlimSubject? = null,
) {
    fun getStatus(): Long = when (type) {
        1 -> Bangumi.PLAN_TO_READ
        2 -> Bangumi.COMPLETED
        3 -> Bangumi.READING
        4 -> Bangumi.ON_HOLD
        5 -> Bangumi.DROPPED
        else -> throw Exception("Unknown status: $type")
    }
}

@Serializable
// Incomplete DTO with only our needed attributes
data class BGMSlimSubject(
    val volumes: Int?,
    val eps: Int?,
)

@Serializable
data class BGMSearchResult(
    val total: Int,
    val limit: Int,
    val offset: Int,
    val data: List<BGMSubject> = emptyList(),
)

@Serializable
// Incomplete DTO with only our needed attributes
data class BGMSubject(
    val id: Long,
    @SerialName("name_cn")
    val nameCn: String,
    val name: String,
    val summary: String?,
    val date: String?, // YYYY-MM-DD
    val images: BGMSubjectImages?,
    val volumes: Long = 0,
    val eps: Long = 0,
    val rating: BGMSubjectRating?,
    val platform: String?,
) {
    fun toTrackSearch(trackerId: Long): TrackSearch = TrackSearch.create(trackerId).apply {
        remote_id = this@BGMSubject.id
        title = nameCn.ifBlank { name }
        cover_url = images?.common.orEmpty()
        summary = if (nameCn.isNotBlank()) {
            "作品原名：$name" + this@BGMSubject.summary?.let { "\n${it.trim()}" }.orEmpty()
        } else {
            this@BGMSubject.summary?.trim().orEmpty()
        }
        score = rating?.score ?: -1.0
        tracking_url = "https://bangumi.tv/subject/${this@BGMSubject.id}"
        total_chapters = eps
        start_date = date ?: ""
    }
}

@Serializable
// Incomplete DTO with only our needed attributes
data class BGMSubjectImages(
    val common: String?,
)

@Serializable
// Incomplete DTO with only our needed attributes
data class BGMSubjectRating(
    val score: Double?,
)
