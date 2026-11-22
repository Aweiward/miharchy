// Ported from mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026
// app/src/main/java/eu/kanade/tachiyomi/data/track/bangumi/Bangumi.kt
// Licensed under Apache-2.0. Changes: English status names instead of string resources; authUrl and authCallback
// carry the code login of Mihon's TrackLoginActivity; a failed login logs out and rethrows, so core can tell a
// refusal from a network failure.

package eu.kanade.tachiyomi.data.track.bangumi

import eu.kanade.tachiyomi.data.track.BaseTracker
import eu.kanade.tachiyomi.data.track.TrackerPrefs
import eu.kanade.tachiyomi.data.track.model.Track
import eu.kanade.tachiyomi.data.track.model.TrackSearch
import eu.kanade.tachiyomi.network.trackJson
import okhttp3.OkHttpClient

class Bangumi(client: OkHttpClient, prefs: TrackerPrefs) : BaseTracker(5L, "Bangumi", client, prefs) {

    private val interceptor by lazy { BangumiInterceptor(this) }

    private val api by lazy { BangumiApi(id, client, interceptor) }

    override val supportsPrivateTracking: Boolean = true

    override fun getScoreList(): List<String> = SCORE_LIST

    override fun displayScore(track: Track): String {
        return track.score.toInt().toString()
    }

    private suspend fun add(track: Track): Track {
        return api.addLibManga(track)
    }

    override suspend fun update(track: Track, didReadChapter: Boolean): Track {
        if (track.status != COMPLETED) {
            if (didReadChapter) {
                if (track.last_chapter_read.toLong() == track.total_chapters && track.total_chapters > 0) {
                    track.status = COMPLETED
                } else {
                    track.status = READING
                }
            }
        }

        return api.updateLibManga(track)
    }

    override suspend fun bind(track: Track, hasReadChapters: Boolean): Track {
        val statusTrack = api.statusLibManga(track, getUsername())
        return if (statusTrack != null) {
            track.copyPersonalFrom(statusTrack, copyRemotePrivate = false)
            track.library_id = statusTrack.library_id
            track.score = statusTrack.score
            track.last_chapter_read = statusTrack.last_chapter_read
            track.total_chapters = statusTrack.total_chapters
            if (track.status != COMPLETED) {
                track.status = if (hasReadChapters) READING else statusTrack.status
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
                return api.getMangaDetails(id)?.let { listOf(it) } ?: emptyList()
            }
        }

        return api.search(query)
    }

    override suspend fun refresh(track: Track): Track {
        val remoteStatusTrack = api.statusLibManga(track, getUsername()) ?: throw Exception("Could not find manga")
        track.copyPersonalFrom(remoteStatusTrack)
        return track
    }

    override fun getStatusList(): List<Long> {
        return listOf(READING, COMPLETED, ON_HOLD, DROPPED, PLAN_TO_READ)
    }

    override fun getStatus(status: Long): String? = when (status) {
        READING -> "Reading"
        PLAN_TO_READ -> "Plan to read"
        COMPLETED -> "Completed"
        ON_HOLD -> "On hold"
        DROPPED -> "Dropped"
        else -> null
    }

    override fun getReadingStatus(): Long = READING

    override fun getRereadingStatus(): Long = -1

    override fun getCompletionStatus(): Long = COMPLETED

    override fun authUrl(): String = BangumiApi.authUrl()

    /** Bangumi's code grant ends on an address whose query holds code. */
    override suspend fun authCallback(url: String) {
        val code = callbackParameter(url, "code") ?: return
        login(code)
    }

    override suspend fun login(username: String, password: String) = login(password)

    suspend fun login(code: String) {
        try {
            val oauth = api.accessToken(code)
            interceptor.newAuth(oauth)
            // Users can set a 'username' (not nickname) once which effectively
            // replaces the stringified ID in certain queries.
            // If no username is set, the API returns the user ID as a strings
            val currentUser = api.getCurrentUser()
            saveDisplayUsername(currentUser.nickname?.takeIf { it.isNotBlank() } ?: currentUser.username)
            saveCredentials(currentUser.username, oauth.accessToken)
        } catch (e: Throwable) {
            // Core's route tells a refused code from a network failure; a CancellationException goes up too.
            logout()
            throw e
        }
    }

    fun saveOAuth(oauth: BGMOAuth?) {
        saveToken(oauth?.let { trackJson.encodeToString(BGMOAuth.serializer(), it) })
    }

    fun loadOAuth(): BGMOAuth? {
        return try {
            trackJson.decodeFromString(BGMOAuth.serializer(), getToken()!!)
        } catch (_: Exception) {
            null
        }
    }

    override fun logout() {
        super.logout()
        interceptor.newAuth(null)
    }

    companion object {
        const val PLAN_TO_READ = 1L
        const val COMPLETED = 2L
        const val READING = 3L
        const val ON_HOLD = 4L
        const val DROPPED = 5L

        private val SCORE_LIST = IntRange(0, 10)
            .map(Int::toString)

        private const val SEARCH_ID_PREFIX = "id:"
    }
}
