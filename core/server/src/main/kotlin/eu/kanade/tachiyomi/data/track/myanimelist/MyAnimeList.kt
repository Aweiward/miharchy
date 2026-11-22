// Ported from mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026
// app/src/main/java/eu/kanade/tachiyomi/data/track/myanimelist/MyAnimeList.kt
// Licensed under Apache-2.0. Changes: English status names instead of string resources; the OAuth object and the
// auth-expired flag are tracker prefs; authUrl and authCallback carry the code login of Mihon's TrackLoginActivity;
// a failed login logs out and rethrows, so core can tell a refusal from a network failure.

package eu.kanade.tachiyomi.data.track.myanimelist

import eu.kanade.tachiyomi.data.track.BaseTracker
import eu.kanade.tachiyomi.data.track.DeletableTracker
import eu.kanade.tachiyomi.data.track.TrackerPrefs
import eu.kanade.tachiyomi.data.track.model.Track
import eu.kanade.tachiyomi.data.track.model.TrackSearch
import eu.kanade.tachiyomi.network.trackJson
import kotlinx.coroutines.CancellationException
import okhttp3.OkHttpClient

class MyAnimeList(client: OkHttpClient, prefs: TrackerPrefs) :
    BaseTracker(1L, "MyAnimeList", client, prefs),
    DeletableTracker {

    companion object {
        const val READING = 1L
        const val COMPLETED = 2L
        const val ON_HOLD = 3L
        const val DROPPED = 4L
        const val PLAN_TO_READ = 6L
        const val REREADING = 7L

        private const val SEARCH_ID_PREFIX = "id:"
        private const val SEARCH_LIST_PREFIX = "my:"

        private const val AUTH_EXPIRED = "myanimelistAuthExpired"

        private val SCORE_LIST = IntRange(0, 10)
            .map(Int::toString)
    }

    private val interceptor by lazy { MyAnimeListInterceptor(this, client) }
    private val api by lazy { MyAnimeListApi(id, client, interceptor) }

    override val supportsReadingDates: Boolean = true

    override fun getStatusList(): List<Long> {
        return listOf(READING, COMPLETED, ON_HOLD, DROPPED, PLAN_TO_READ, REREADING)
    }

    override fun getStatus(status: Long): String? = when (status) {
        READING -> "Reading"
        PLAN_TO_READ -> "Plan to read"
        COMPLETED -> "Completed"
        ON_HOLD -> "On hold"
        DROPPED -> "Dropped"
        REREADING -> "Rereading"
        else -> null
    }

    override fun getReadingStatus(): Long = READING

    override fun getRereadingStatus(): Long = REREADING

    override fun getCompletionStatus(): Long = COMPLETED

    override fun getScoreList(): List<String> = SCORE_LIST

    override fun displayScore(track: Track): String {
        return track.score.toInt().toString()
    }

    private suspend fun add(track: Track): Track {
        return api.updateItem(track)
    }

    override suspend fun update(track: Track, didReadChapter: Boolean): Track {
        if (track.status != COMPLETED) {
            if (didReadChapter) {
                if (track.last_chapter_read.toLong() == track.total_chapters && track.total_chapters > 0) {
                    track.status = COMPLETED
                    track.finished_reading_date = System.currentTimeMillis()
                } else if (track.status != REREADING) {
                    track.status = READING
                    if (track.last_chapter_read == 1.0) {
                        track.started_reading_date = System.currentTimeMillis()
                    }
                }
            }
        }

        return api.updateItem(track)
    }

    override suspend fun delete(track: Track) {
        api.deleteItem(track)
    }

    override suspend fun bind(track: Track, hasReadChapters: Boolean): Track {
        val remoteTrack = api.findListItem(track)
        return if (remoteTrack != null) {
            track.copyPersonalFrom(remoteTrack)
            track.remote_id = remoteTrack.remote_id

            if (track.status != COMPLETED) {
                val isRereading = track.status == REREADING
                track.status = if (!isRereading && hasReadChapters) READING else track.status
            }

            update(track)
        } else {
            // Set default fields if it's not found in the list
            track.status = if (hasReadChapters) READING else PLAN_TO_READ
            track.score = 0.0
            add(track)
        }
    }

    override suspend fun search(query: String): List<TrackSearch> {
        if (query.startsWith(SEARCH_ID_PREFIX)) {
            query.substringAfter(SEARCH_ID_PREFIX).trim().toIntOrNull()?.let { id ->
                return listOf(api.getMangaDetails(id))
            }
        }

        if (query.startsWith(SEARCH_LIST_PREFIX)) {
            query.substringAfter(SEARCH_LIST_PREFIX).let { title ->
                return api.findListItems(title)
            }
        }

        return api.search(query)
    }

    override suspend fun refresh(track: Track): Track {
        return api.findListItem(track) ?: add(track)
    }

    /** The login address. Core asks for it on every tracker.list; it stays the same until the login ends. */
    override fun authUrl(): String = api.authUrl()

    /** MAL's authorization-code grant ends on an address whose query holds code. */
    override suspend fun authCallback(url: String) {
        val code = callbackParameter(url, "code") ?: return
        login(code)
    }

    override suspend fun login(username: String, password: String) = login(password)

    suspend fun login(authCode: String) {
        try {
            trackPreferences.delete(AUTH_EXPIRED)
            val oauth = api.getAccessToken(authCode)
            interceptor.setAuth(oauth)
            val username = api.getCurrentUser()
            saveDisplayUsername(username)
            saveCredentials(username, oauth.accessToken)
            api.endLogin()
        } catch (e: CancellationException) {
            logout()
            throw e
        } catch (e: Throwable) {
            // Core's route tells a refused code from a network failure.
            logout()
            throw e
        }
    }

    override fun logout() {
        super.logout()
        saveToken(null)
        trackPreferences.delete(AUTH_EXPIRED)
        interceptor.setAuth(null)
        api.endLogin()
    }

    fun getIfAuthExpired(): Boolean {
        return trackPreferences[AUTH_EXPIRED] == "true"
    }

    fun setAuthExpired() {
        trackPreferences[AUTH_EXPIRED] = "true"
    }

    fun saveOAuth(oAuth: MALOAuth?) {
        saveToken(oAuth?.let { trackJson.encodeToString(MALOAuth.serializer(), it) })
    }

    fun loadOAuth(): MALOAuth? {
        return try {
            trackJson.decodeFromString(MALOAuth.serializer(), getToken()!!)
        } catch (_: Exception) {
            null
        }
    }
}
