// Ported from mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026
// app/src/main/java/eu/kanade/tachiyomi/data/track/shikimori/Shikimori.kt
// Licensed under Apache-2.0. Changes: English status names instead of string resources; authUrl and authCallback
// carry the code login of Mihon's TrackLoginActivity; a failed login logs out and rethrows, so core can tell a
// refusal from a network failure.

package eu.kanade.tachiyomi.data.track.shikimori

import eu.kanade.tachiyomi.data.track.BaseTracker
import eu.kanade.tachiyomi.data.track.DeletableTracker
import eu.kanade.tachiyomi.data.track.TrackerPrefs
import eu.kanade.tachiyomi.data.track.model.Track
import eu.kanade.tachiyomi.data.track.model.TrackSearch
import eu.kanade.tachiyomi.network.trackJson
import kotlinx.coroutines.CancellationException
import okhttp3.OkHttpClient

class Shikimori(client: OkHttpClient, prefs: TrackerPrefs) :
    BaseTracker(4L, "Shikimori", client, prefs),
    DeletableTracker {

    companion object {
        const val READING = 1L
        const val COMPLETED = 2L
        const val ON_HOLD = 3L
        const val DROPPED = 4L
        const val PLAN_TO_READ = 5L
        const val REREADING = 6L

        private val SCORE_LIST = IntRange(0, 10)
            .map(Int::toString)

        private const val SEARCH_ID_PREFIX = "id:"
    }

    private val interceptor by lazy { ShikimoriInterceptor(this) }

    private val api by lazy { ShikimoriApi(id, client, interceptor) }

    override fun getScoreList(): List<String> = SCORE_LIST

    override fun displayScore(track: Track): String {
        return track.score.toInt().toString()
    }

    private suspend fun add(track: Track): Track {
        return api.addLibManga(track, getUsername())
    }

    override suspend fun update(track: Track, didReadChapter: Boolean): Track {
        if (track.status != COMPLETED) {
            if (didReadChapter) {
                if (track.last_chapter_read.toLong() == track.total_chapters && track.total_chapters > 0) {
                    track.status = COMPLETED
                } else if (track.status != REREADING) {
                    track.status = READING
                }
            }
        }

        return api.updateLibManga(track)
    }

    override suspend fun delete(track: Track) {
        api.deleteLibManga(track)
    }

    override suspend fun bind(track: Track, hasReadChapters: Boolean): Track {
        val remoteTrack = api.findLibManga(track)
        return if (remoteTrack != null) {
            track.copyPersonalFrom(remoteTrack)
            track.library_id = remoteTrack.library_id

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
                return api.getMangaDetails(id)?.let { listOf(it) } ?: emptyList()
            }
        }

        return api.search(query)
    }

    override suspend fun refresh(track: Track): Track {
        val remoteTrack = api.findLibManga(track) ?: throw Exception("Could not find manga")
        track.library_id = remoteTrack.library_id
        track.copyPersonalFrom(remoteTrack)
        track.total_chapters = remoteTrack.total_chapters
        return track
    }

    override fun getStatusList(): List<Long> {
        return listOf(READING, COMPLETED, ON_HOLD, DROPPED, PLAN_TO_READ, REREADING)
    }

    override fun getStatus(status: Long): String? = when (status) {
        READING -> "Reading"
        PLAN_TO_READ -> "Plan to read"
        COMPLETED -> "Completed"
        ON_HOLD -> "On hold"
        DROPPED -> "Dropped"
        REREADING -> "Repeating"
        else -> null
    }

    override fun getReadingStatus(): Long = READING

    override fun getRereadingStatus(): Long = REREADING

    override fun getCompletionStatus(): Long = COMPLETED

    override fun authUrl(): String = ShikimoriApi.authUrl()

    /** The address Suwayomi's redirect page shows ends in ?code=. */
    override suspend fun authCallback(url: String) {
        val code = callbackParameter(url, "code") ?: return
        login(code)
    }

    override suspend fun login(username: String, password: String) = login(password)

    suspend fun login(code: String) {
        try {
            val oauth = api.accessToken(code)
            interceptor.newAuth(oauth)
            val user = api.getCurrentUser()
            saveDisplayUsername(user.nickname)
            saveCredentials(user.id, oauth.accessToken)
        } catch (e: CancellationException) {
            logout()
            throw e
        } catch (e: Throwable) {
            // Core's route tells a refused code from a network failure.
            logout()
            throw e
        }
    }

    fun saveOAuth(oauth: SMOAuth?) {
        saveToken(oauth?.let { trackJson.encodeToString(SMOAuth.serializer(), it) })
    }

    fun loadOAuth(): SMOAuth? {
        return try {
            trackJson.decodeFromString(SMOAuth.serializer(), getToken()!!)
        } catch (_: Exception) {
            null
        }
    }

    override fun logout() {
        super.logout()
        saveToken(null)
        interceptor.newAuth(null)
    }
}
