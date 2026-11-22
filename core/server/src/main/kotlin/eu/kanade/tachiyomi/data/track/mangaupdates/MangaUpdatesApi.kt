// Ported from mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026
// app/src/main/java/eu/kanade/tachiyomi/data/track/mangaupdates/MangaUpdatesApi.kt and dto/*.kt
// Licensed under Apache-2.0. Changes: no Dispatchers.IO hop (core's calls already run off the request threads);
// the shared lenient Json of TrackNetwork; Jsoup for htmlDecode; no rate limiter (Mihon has none); an
// add-to-list reply is closed; getSeriesDetails fails on an HTTP error other than 404 instead of reading its body.

package eu.kanade.tachiyomi.data.track.mangaupdates

import eu.kanade.tachiyomi.data.track.mangaupdates.MangaUpdates.Companion.READING_LIST
import eu.kanade.tachiyomi.data.track.mangaupdates.MangaUpdates.Companion.WISH_LIST
import eu.kanade.tachiyomi.data.track.model.Track
import eu.kanade.tachiyomi.data.track.model.TrackSearch
import eu.kanade.tachiyomi.network.DELETE
import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.network.HttpException
import eu.kanade.tachiyomi.network.POST
import eu.kanade.tachiyomi.network.PUT
import eu.kanade.tachiyomi.network.await
import eu.kanade.tachiyomi.network.awaitSuccess
import eu.kanade.tachiyomi.network.jsonMime
import eu.kanade.tachiyomi.network.parseAs
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import org.jsoup.Jsoup

class MangaUpdatesApi(
    private val client: OkHttpClient,
    interceptor: MangaUpdatesInterceptor,
) {

    private val authClient by lazy {
        client.newBuilder()
            .addInterceptor(interceptor)
            .build()
    }

    suspend fun getSeriesListItem(track: Track): Pair<MUListItem, MURating?> {
        val listItem = authClient.newCall(GET("$BASE_URL/v1/lists/series/${track.remote_id}"))
            .awaitSuccess()
            .parseAs<MUListItem>()

        val rating = getSeriesRating(track)

        return listItem to rating
    }

    suspend fun addSeriesToList(track: Track, hasReadChapters: Boolean) {
        val status = if (hasReadChapters) READING_LIST else WISH_LIST
        val body = buildJsonArray {
            addJsonObject {
                putJsonObject("series") {
                    put("id", track.remote_id)
                }
                put("list_id", status)
            }
        }
        authClient.newCall(
            POST(
                url = "$BASE_URL/v1/lists/series",
                body = body.toString().toRequestBody(jsonMime),
            ),
        )
            .awaitSuccess()
            .use {
                if (it.code == 200) {
                    track.status = status
                    track.last_chapter_read = 1.0
                }
            }
    }

    suspend fun updateSeriesListItem(track: Track) {
        val body = buildJsonArray {
            addJsonObject {
                putJsonObject("series") {
                    put("id", track.remote_id)
                }
                put("list_id", track.status)
                putJsonObject("status") {
                    put("chapter", track.last_chapter_read.toInt())
                }
            }
        }
        authClient.newCall(
            POST(
                url = "$BASE_URL/v1/lists/series/update",
                body = body.toString().toRequestBody(jsonMime),
            ),
        )
            .awaitSuccess().close()

        updateSeriesRating(track)
    }

    suspend fun deleteSeriesFromList(track: Track) {
        val body = buildJsonArray {
            add(track.remote_id)
        }
        authClient.newCall(
            POST(
                url = "$BASE_URL/v1/lists/series/delete",
                body = body.toString().toRequestBody(jsonMime),
            ),
        )
            .awaitSuccess().close()
    }

    private suspend fun getSeriesRating(track: Track): MURating? {
        return try {
            authClient.newCall(GET("$BASE_URL/v1/series/${track.remote_id}/rating"))
                .awaitSuccess()
                .parseAs<MURating>()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            null
        }
    }

    private suspend fun updateSeriesRating(track: Track) {
        if (track.score < 0.0) return
        if (track.score != 0.0) {
            val body = buildJsonObject {
                put("rating", track.score)
            }
            authClient.newCall(
                PUT(
                    url = "$BASE_URL/v1/series/${track.remote_id}/rating",
                    body = body.toString().toRequestBody(jsonMime),
                ),
            )
                .awaitSuccess().close()
        } else {
            authClient.newCall(
                DELETE(url = "$BASE_URL/v1/series/${track.remote_id}/rating"),
            )
                .awaitSuccess().close()
        }
    }

    suspend fun search(query: String): List<MURecord> {
        val body = buildJsonObject {
            put("search", query)
            put(
                "filter_types",
                buildJsonArray {
                    add("drama cd")
                    add("novel")
                },
            )
        }

        return client.newCall(
            POST(
                url = "$BASE_URL/v1/series/search",
                body = body.toString().toRequestBody(jsonMime),
            ),
        )
            .awaitSuccess()
            .parseAs<MUSearchResult>()
            .results
            .map { it.record }
    }

    suspend fun getSeriesDetails(id: Long): MURecord? {
        val response = client.newCall(GET("$BASE_URL/v1/series/$id")).await()
        if (response.code == 404) {
            response.close()
            return null
        }
        // A reply that is not a success must not be read as a series.
        if (!response.isSuccessful) {
            response.close()
            throw HttpException(response.code)
        }
        return response.parseAs<MURecord>()
    }

    suspend fun authenticate(username: String, password: String): MUContext {
        val body = buildJsonObject {
            put("username", username)
            put("password", password)
        }
        return client.newCall(
            PUT(
                url = "$BASE_URL/v1/account/login",
                body = body.toString().toRequestBody(jsonMime),
            ),
        )
            .awaitSuccess()
            .parseAs<MULoginResponse>()
            .context
    }

    suspend fun getCurrentUser(): MUCurrentUser {
        return authClient.newCall(GET("$BASE_URL/v1/account/profile"))
            .awaitSuccess()
            .parseAs<MUCurrentUser>()
    }

    companion object {
        private const val BASE_URL = "https://api.mangaupdates.com"
    }
}

@Serializable
data class MUAuthor(
    val name: String,
    val type: String,
)

@Serializable
data class MUContext(
    @SerialName("session_token")
    val sessionToken: String,
    val uid: Long,
)

@Serializable
data class MUCurrentUser(
    val username: String,
)

@Serializable
data class MUImage(
    val url: MUUrl? = null,
    val height: Int? = null,
    val width: Int? = null,
)

@Serializable
data class MUListItem(
    val series: MUSeries? = null,
    @SerialName("list_id")
    val listId: Long? = null,
    val status: MUStatus? = null,
    val priority: Int? = null,
) {
    fun copyTo(track: Track): Track {
        return track.apply {
            this.status = listId ?: READING_LIST
            this.last_chapter_read = this@MUListItem.status?.chapter?.toDouble() ?: 0.0
        }
    }
}

@Serializable
data class MULoginResponse(
    val context: MUContext,
)

@Serializable
data class MURating(
    val rating: Double? = null,
) {
    fun copyTo(track: Track): Track {
        return track.apply {
            this.score = rating ?: 0.0
        }
    }
}

@Serializable
data class MURecord(
    @SerialName("series_id")
    val seriesId: Long? = null,
    val title: String? = null,
    val url: String? = null,
    val description: String? = null,
    val image: MUImage? = null,
    val type: String? = null,
    val year: String? = null,
    @SerialName("bayesian_rating")
    val bayesianRating: Double? = null,
    @SerialName("rating_votes")
    val ratingVotes: Int? = null,
    @SerialName("latest_chapter")
    val latestChapter: Int? = null,
    val authors: List<MUAuthor> = emptyList(),
) {
    fun toTrackSearch(id: Long): TrackSearch {
        return TrackSearch.create(id).apply {
            remote_id = this@MURecord.seriesId ?: 0L
            title = this@MURecord.title?.htmlDecode() ?: ""
            total_chapters = 0
            cover_url = this@MURecord.image?.url?.original ?: ""
            summary = this@MURecord.description?.htmlDecode() ?: ""
            tracking_url = this@MURecord.url ?: ""
            publishing_status = ""
            publishing_type = this@MURecord.type.toString()
            start_date = this@MURecord.year.toString()
            score = this@MURecord.bayesianRating?.takeIf { it > 0 } ?: -1.0
            authors = this@MURecord.authors.filter { it.type == "Author" }.map { it.name }
            artists = this@MURecord.authors.filter { it.type == "Artist" }.map { it.name }
        }
    }
}

private fun String.htmlDecode(): String = Jsoup.parse(this).wholeText()

@Serializable
data class MUSearchResult(
    val results: List<MUSearchResultItem>,
)

@Serializable
data class MUSearchResultItem(
    val record: MURecord,
)

@Serializable
data class MUSeries(
    val id: Long? = null,
    val title: String? = null,
)

@Serializable
data class MUStatus(
    val volume: Int? = null,
    val chapter: Int? = null,
)

@Serializable
data class MUUrl(
    val original: String? = null,
    val thumb: String? = null,
)
