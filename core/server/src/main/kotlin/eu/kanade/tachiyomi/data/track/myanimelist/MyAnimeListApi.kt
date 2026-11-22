// Ported from mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026
// app/src/main/java/eu/kanade/tachiyomi/data/track/myanimelist/MyAnimeListApi.kt and MyAnimeListUtils.kt
// Licensed under Apache-2.0. Changes: okhttp3 HttpUrl instead of Android Uri; the PKCE verifier lives in the
// instance and stays the same until the login ends (core asks for the login address on every tracker.list);
// Suwayomi's registered client, whose redirect leaves the callback in the address bar.

package eu.kanade.tachiyomi.data.track.myanimelist

import eu.kanade.tachiyomi.data.track.model.Track
import eu.kanade.tachiyomi.data.track.model.TrackSearch
import eu.kanade.tachiyomi.network.DELETE
import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.network.HttpException
import eu.kanade.tachiyomi.network.POST
import eu.kanade.tachiyomi.network.await
import eu.kanade.tachiyomi.network.awaitSuccess
import eu.kanade.tachiyomi.network.parseAs
import eu.kanade.tachiyomi.util.PkceUtil
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.FormBody
import okhttp3.Headers
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import java.text.SimpleDateFormat
import java.util.Locale

class MyAnimeListApi(
    private val trackerId: Long,
    private val client: OkHttpClient,
    interceptor: MyAnimeListInterceptor,
) {

    private val authClient = client.newBuilder().addInterceptor(interceptor).build()

    // The verifier of the login address handed out last; kept until the login ends.
    private var codeVerifier: String? = null

    /** The login address. MAL's PKCE is "plain", so the challenge is the verifier. */
    @Synchronized
    fun authUrl(): String {
        val verifier = codeVerifier ?: PkceUtil.generateCodeVerifier().also { codeVerifier = it }
        return "$BASE_OAUTH_URL/authorize".toHttpUrl().newBuilder()
            .addQueryParameter("client_id", CLIENT_ID)
            .addQueryParameter("code_challenge", verifier)
            .addQueryParameter("response_type", "code")
            .build()
            .toString()
    }

    /** A login ended, with success or not: the next login address gets a new verifier. */
    @Synchronized
    fun endLogin() {
        codeVerifier = null
    }

    suspend fun getAccessToken(authCode: String): MALOAuth {
        val verifier = synchronized(this) { codeVerifier } ?: throw Exception("No MyAnimeList login is under way.")
        return withContext(Dispatchers.IO) {
            val formBody: RequestBody = FormBody.Builder()
                .add("client_id", CLIENT_ID)
                .add("code", authCode)
                .add("code_verifier", verifier)
                .add("grant_type", "authorization_code")
                .build()
            client.newCall(POST("$BASE_OAUTH_URL/token", body = formBody))
                .awaitSuccess()
                .parseAs<MALOAuth>()
        }
    }

    suspend fun getCurrentUser(): String {
        return withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("$BASE_API_URL/users/@me")
                .get()
                .build()
            authClient.newCall(request)
                .awaitSuccess()
                .parseAs<MALUser>()
                .name
        }
    }

    suspend fun search(query: String): List<TrackSearch> {
        return withContext(Dispatchers.IO) {
            val url = "$BASE_API_URL/manga".toHttpUrl().newBuilder()
                // MAL API throws a 400 when the query is over 64 characters...
                .addQueryParameter("q", query.take(64))
                .addQueryParameter("nsfw", "true")
                .addQueryParameter("fields", SEARCH_FIELDS)
                .build()
            authClient.newCall(GET(url))
                .awaitSuccess()
                .parseAs<MALSearchResult>()
                .data
                .filter { !(it.node.mediaType.contains("novel")) }
                .map { parseSearchItem(it.node) }
        }
    }

    suspend fun getMangaDetails(id: Int): TrackSearch {
        return withContext(Dispatchers.IO) {
            val url = "$BASE_API_URL/manga".toHttpUrl().newBuilder()
                .addPathSegment(id.toString())
                .addQueryParameter("fields", SEARCH_FIELDS)
                .build()
            authClient.newCall(GET(url))
                .awaitSuccess()
                .parseAs<MALManga>()
                .let { parseSearchItem(it) }
        }
    }

    suspend fun updateItem(track: Track): Track {
        return withContext(Dispatchers.IO) {
            val formBodyBuilder = FormBody.Builder()
                .add("status", track.toMyAnimeListStatus() ?: "reading")
                .add("is_rereading", (track.status == MyAnimeList.REREADING).toString())
                .add("score", track.score.toString())
                .add("num_chapters_read", track.last_chapter_read.toInt().toString())
            convertToIsoDate(track.started_reading_date)?.let {
                formBodyBuilder.add("start_date", it)
            }
            convertToIsoDate(track.finished_reading_date)?.let {
                formBodyBuilder.add("finish_date", it)
            }

            val request = Request.Builder()
                .url(mangaUrl(track.remote_id))
                .put(formBodyBuilder.build())
                .build()
            val response = authClient
                .newCall(request)
                .await()

            if (!response.isSuccessful) {
                if (response.body.string().contains("invalid_content")) {
                    // MAL returns unapproved titles in search but does not allow adding them to the list
                    // returns 400 with this body: {"message":"Invalid content","error":"invalid_content"}
                    // These unapproved titles cannot be filtered out in search and are also returned by the
                    // endpoint we use for id prefix search
                    throw MALTitleNotApproved()
                } else {
                    throw HttpException(response.code)
                }
            }

            response
                .parseAs<MALListItemStatus>()
                .let { parseMangaItem(it, track) }
        }
    }

    suspend fun deleteItem(track: Track) {
        withContext(Dispatchers.IO) {
            authClient
                .newCall(DELETE(mangaUrl(track.remote_id).toString()))
                .awaitSuccess().close()
        }
    }

    suspend fun findListItem(track: Track): Track? {
        return withContext(Dispatchers.IO) {
            val url = "$BASE_API_URL/manga".toHttpUrl().newBuilder()
                .addPathSegment(track.remote_id.toString())
                .addQueryParameter("fields", "num_chapters,my_list_status{start_date,finish_date}")
                .build()
            authClient.newCall(GET(url))
                .awaitSuccess()
                .parseAs<MALListItem>()
                .let { item ->
                    track.total_chapters = item.numChapters
                    item.myListStatus?.let { parseMangaItem(it, track) }
                }
        }
    }

    suspend fun findListItems(query: String, offset: Int = 0): List<TrackSearch> {
        return withContext(Dispatchers.IO) {
            val myListSearchResult = getListPage(offset)

            val matches = myListSearchResult.data
                .filter { it.node.title.contains(query, ignoreCase = true) }
                .map { parseSearchItem(it.node) }

            // Check next page if there's more
            if (!myListSearchResult.paging.next.isNullOrBlank()) {
                matches + findListItems(query, offset + LIST_PAGINATION_AMOUNT)
            } else {
                matches
            }
        }
    }

    private suspend fun getListPage(offset: Int): MALSearchResult {
        return withContext(Dispatchers.IO) {
            val urlBuilder = "$BASE_API_URL/users/@me/mangalist".toHttpUrl().newBuilder()
                .addQueryParameter("fields", SEARCH_FIELDS)
                .addQueryParameter("limit", LIST_PAGINATION_AMOUNT.toString())
            if (offset > 0) {
                urlBuilder.addQueryParameter("offset", offset.toString())
            }

            val request = Request.Builder()
                .url(urlBuilder.build())
                .get()
                .build()
            authClient.newCall(request)
                .awaitSuccess()
                .parseAs<MALSearchResult>()
        }
    }

    private fun parseMangaItem(listStatus: MALListItemStatus, track: Track): Track {
        return track.apply {
            val isRereading = listStatus.isRereading
            status = if (isRereading) MyAnimeList.REREADING else getStatus(listStatus.status)
            last_chapter_read = listStatus.numChaptersRead
            score = listStatus.score.toDouble()
            listStatus.startDate?.let { started_reading_date = parseDate(it) }
            listStatus.finishDate?.let { finished_reading_date = parseDate(it) }
        }
    }

    private fun parseSearchItem(searchItem: MALManga): TrackSearch {
        return TrackSearch.create(trackerId).apply {
            remote_id = searchItem.id
            title = searchItem.title
            summary = searchItem.synopsis
            total_chapters = searchItem.numChapters
            score = searchItem.mean
            cover_url = searchItem.covers?.large.orEmpty()
            tracking_url = "https://myanimelist.net/manga/$remote_id"
            publishing_status = searchItem.status.replace("_", " ")
            publishing_type = searchItem.mediaType.replace("_", " ")
            start_date = searchItem.startDate ?: ""
            artists = searchItem.authors
                .filter { authorNode -> authorNode.role == "Art" }
                .mapNotNull { authorNode -> authorNode.node.getFullName() }
            authors = searchItem.authors
                // count all with "Story" or "Story & Art" as authors, like is done for library entries
                .filter { authorNode -> authorNode.role.contains("Story") }
                .mapNotNull { authorNode -> authorNode.node.getFullName() }
        }
    }

    private fun parseDate(isoDate: String): Long {
        val pattern = when (isoDate.length) {
            10 -> "yyyy-MM-dd"
            7 -> "yyyy-MM"
            4 -> "yyyy"
            else -> throw IllegalArgumentException("Unsupported date format: \"$isoDate\"")
        }
        return SimpleDateFormat(pattern, Locale.US).parse(isoDate)?.time ?: 0L
    }

    private fun convertToIsoDate(epochTime: Long): String? {
        if (epochTime == 0L) {
            return ""
        }
        return try {
            val outputDf = SimpleDateFormat("yyyy-MM-dd", Locale.US)
            outputDf.format(epochTime)
        } catch (_: Exception) {
            null
        }
    }

    companion object {
        // Suwayomi's registered client (Suwayomi-Server's MyAnimeListApi), whose redirect leaves the callback in the address bar.
        // It sends no redirect_uri, so neither does this.
        private const val CLIENT_ID = "3fda277931a4f9bc01fa4a715ce8b91d"

        private const val BASE_OAUTH_URL = "https://myanimelist.net/v1/oauth2"
        private const val BASE_API_URL = "https://api.myanimelist.net/v2"

        private const val SEARCH_FIELDS =
            "id,title,synopsis,num_chapters,mean,main_picture,status,media_type,start_date,authors{first_name,last_name}"

        private const val LIST_PAGINATION_AMOUNT = 250

        fun mangaUrl(id: Long): HttpUrl = "$BASE_API_URL/manga".toHttpUrl().newBuilder()
            .addPathSegment(id.toString())
            .addPathSegment("my_list_status")
            .build()

        fun refreshTokenRequest(oauth: MALOAuth): Request {
            val formBody: RequestBody = FormBody.Builder()
                .add("client_id", CLIENT_ID)
                .add("refresh_token", oauth.refreshToken)
                .add("grant_type", "refresh_token")
                .build()

            // Add the Authorization header manually as this particular
            // request is called by the interceptor itself so it doesn't reach
            // the part where the token is added automatically.
            val headers = Headers.Builder()
                .add("Authorization", "Bearer ${oauth.accessToken}")
                .build()

            return POST("$BASE_OAUTH_URL/token", body = formBody, headers = headers)
        }
    }
}

internal fun Track.toMyAnimeListStatus() = when (status) {
    MyAnimeList.READING -> "reading"
    MyAnimeList.COMPLETED -> "completed"
    MyAnimeList.ON_HOLD -> "on_hold"
    MyAnimeList.DROPPED -> "dropped"
    MyAnimeList.PLAN_TO_READ -> "plan_to_read"
    MyAnimeList.REREADING -> "reading"
    else -> null
}

internal fun getStatus(status: String?) = when (status) {
    "reading" -> MyAnimeList.READING
    "completed" -> MyAnimeList.COMPLETED
    "on_hold" -> MyAnimeList.ON_HOLD
    "dropped" -> MyAnimeList.DROPPED
    "plan_to_read" -> MyAnimeList.PLAN_TO_READ
    else -> MyAnimeList.READING
}
