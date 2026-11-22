// Ported from mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026
// app/src/main/java/eu/kanade/tachiyomi/data/track/mangaupdates/MangaUpdates.kt
// Licensed under Apache-2.0. Changes: English status names instead of string resources; a failed login logs out
// and rethrows, so core can tell a refusal from a network failure; logout also clears the interceptor's session,
// which Mihon left in memory.

package eu.kanade.tachiyomi.data.track.mangaupdates

import eu.kanade.tachiyomi.data.track.BaseTracker
import eu.kanade.tachiyomi.data.track.DeletableTracker
import eu.kanade.tachiyomi.data.track.TrackerPrefs
import eu.kanade.tachiyomi.data.track.model.Track
import eu.kanade.tachiyomi.data.track.model.TrackSearch
import kotlinx.coroutines.CancellationException
import okhttp3.OkHttpClient

class MangaUpdates(client: OkHttpClient, prefs: TrackerPrefs) :
    BaseTracker(7L, "MangaUpdates", client, prefs),
    DeletableTracker {

    companion object {
        const val READING_LIST = 0L
        const val WISH_LIST = 1L
        const val COMPLETE_LIST = 2L
        const val UNFINISHED_LIST = 3L
        const val ON_HOLD_LIST = 4L

        private val SCORE_LIST = (0..10)
            .flatMap { decimal ->
                when (decimal) {
                    0 -> listOf("-")
                    10 -> listOf("10.0")
                    else -> (0..9).map { fraction ->
                        "$decimal.$fraction"
                    }
                }
            }

        private const val SEARCH_ID_PREFIX = "id:"
    }

    private val interceptor by lazy { MangaUpdatesInterceptor(this) }

    private val api by lazy { MangaUpdatesApi(client, interceptor) }

    override fun getStatusList(): List<Long> {
        return listOf(READING_LIST, COMPLETE_LIST, ON_HOLD_LIST, UNFINISHED_LIST, WISH_LIST)
    }

    override fun getStatus(status: Long): String? = when (status) {
        READING_LIST -> "Reading list"
        WISH_LIST -> "Wish list"
        COMPLETE_LIST -> "Complete list"
        ON_HOLD_LIST -> "On hold list"
        UNFINISHED_LIST -> "Unfinished list"
        else -> null
    }

    override fun getReadingStatus(): Long = READING_LIST

    override fun getRereadingStatus(): Long = -1

    override fun getCompletionStatus(): Long = COMPLETE_LIST

    override fun getScoreList(): List<String> = SCORE_LIST

    override fun indexToScore(index: Int): Double = if (index == 0) 0.0 else SCORE_LIST[index].toDouble()

    override fun displayScore(track: Track): String = track.score.toString()

    override suspend fun update(track: Track, didReadChapter: Boolean): Track {
        if (track.status != COMPLETE_LIST && didReadChapter) {
            track.status = READING_LIST
        }
        api.updateSeriesListItem(track)
        return track
    }

    override suspend fun delete(track: Track) {
        api.deleteSeriesFromList(track)
    }

    override suspend fun bind(track: Track, hasReadChapters: Boolean): Track {
        return try {
            val (series, rating) = api.getSeriesListItem(track)
            track.copyFrom(series, rating)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            track.score = 0.0
            api.addSeriesToList(track, hasReadChapters)
            track
        }
    }

    override suspend fun search(query: String): List<TrackSearch> {
        if (query.startsWith(SEARCH_ID_PREFIX)) {
            return try {
                val stringId = query.substringAfter(SEARCH_ID_PREFIX).trim()
                val searchId = stringId.toLongOrNull() ?: stringId.toLong(36)

                api.getSeriesDetails(searchId)?.let { listOf(it.toTrackSearch(id)) } ?: emptyList()
            } catch (_: NumberFormatException) {
                emptyList()
            }
        }

        return api.search(query)
            .map {
                it.toTrackSearch(id)
            }
    }

    override suspend fun refresh(track: Track): Track {
        val (series, rating) = api.getSeriesListItem(track)
        return track.copyFrom(series, rating)
    }

    private fun Track.copyFrom(item: MUListItem, rating: MURating?): Track = apply {
        item.copyTo(this)
        score = rating?.rating ?: 0.0
    }

    override suspend fun login(username: String, password: String) {
        try {
            val authenticated = api.authenticate(username, password)
            interceptor.newAuth(authenticated.sessionToken)
            val currentUser = api.getCurrentUser()
            saveDisplayUsername(currentUser.username)
            saveCredentials(authenticated.uid.toString(), authenticated.sessionToken)
        } catch (e: Throwable) {
            // Core's route tells a refused login from a network failure; a CancellationException goes up too.
            logout()
            throw e
        }
    }

    override fun logout() {
        super.logout()
        interceptor.newAuth(null)
    }

    fun restoreSession(): String? {
        return getPassword().ifBlank { null }
    }
}
