// Ported from mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026
// app/src/main/java/eu/kanade/tachiyomi/data/track/mangabaka/MangaBaka.kt
// Licensed under Apache-2.0. Changes: English status names instead of string resources; the score type is a
// tracker pref (mangabakaScoreType); authUrl and authCallback carry the code login of Mihon's TrackLoginActivity,
// with no state parameter, as Suwayomi's login address has none; a failed login logs out and rethrows, so core can
// tell a refusal from a network failure; the PKCE verifier lives in the api instance, not in statics, and ends
// with the login.

package eu.kanade.tachiyomi.data.track.mangabaka

import eu.kanade.tachiyomi.data.track.BaseTracker
import eu.kanade.tachiyomi.data.track.DeletableTracker
import eu.kanade.tachiyomi.data.track.TrackerPrefs
import eu.kanade.tachiyomi.data.track.model.Track
import eu.kanade.tachiyomi.data.track.model.TrackSearch
import eu.kanade.tachiyomi.network.trackJson
import okhttp3.OkHttpClient

class MangaBaka(client: OkHttpClient, prefs: TrackerPrefs) :
    BaseTracker(11L, "MangaBaka", client, prefs),
    DeletableTracker {

    private val interceptor by lazy { MangaBakaInterceptor(this) }
    private val api by lazy { MangaBakaApi(id, client, interceptor) }

    override val supportsReadingDates: Boolean = true
    override val supportsPrivateTracking: Boolean = true

    // Mihon's default for the mangabakaScoreType preference is not in this tree; the finest step is the safe one.
    private fun scoreType() = trackPreferences[SCORE_TYPE] ?: STEP_1

    override fun getStatusList(): List<Long> {
        return listOf(READING, COMPLETED, PAUSED, DROPPED, PLAN_TO_READ, REREADING, CONSIDERING)
    }

    override fun getStatus(status: Long): String? = when (status) {
        CONSIDERING -> "Considering"
        COMPLETED -> "Completed"
        DROPPED -> "Dropped"
        PAUSED -> "Paused"
        PLAN_TO_READ -> "Plan to read"
        READING -> "Reading"
        REREADING -> "Rereading"
        else -> null
    }

    override fun getReadingStatus(): Long = READING

    override fun getRereadingStatus(): Long = REREADING

    override fun getCompletionStatus(): Long = COMPLETED

    override fun getScoreList(): List<String> = getScoreRange().map(Int::toString)

    // score preference only dictates step size, scores are always 0-100
    override fun get10PointScore(track: Track): Double = track.score / 10.0

    override fun indexToScore(index: Int): Double = getScoreRange().toList()[index].toDouble()

    override fun displayScore(track: Track): String = track.score.toInt().toString()

    override suspend fun update(
        track: Track,
        didReadChapter: Boolean,
    ): Track {
        if (track.status != COMPLETED && didReadChapter) {
            if (track.total_chapters > 0 && track.last_chapter_read.toLong() == track.total_chapters) {
                track.status = COMPLETED
                track.finished_reading_date = System.currentTimeMillis()
            } else if (track.status != REREADING) {
                track.status = READING
                if (track.last_chapter_read == 1.0) {
                    track.started_reading_date = System.currentTimeMillis()
                }
            }
        }

        return api.updateLibManga(track)
    }

    override suspend fun bind(
        track: Track,
        hasReadChapters: Boolean,
    ): Track {
        val remoteTrack = api.findLibManga(track)
        return if (remoteTrack != null) {
            track.copyPersonalFrom(remoteTrack, copyRemotePrivate = false)
            track.title = remoteTrack.title
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

            api.addLibManga(track)
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
        track.copyPersonalFrom(remoteTrack)
        track.remote_id = remoteTrack.remote_id
        track.title = remoteTrack.title
        return track
    }

    /** The login address; it carries the PKCE challenge, so it is the same until the login ends. */
    override fun authUrl(): String = api.authUrl()

    /** MangaBaka's code grant ends on an address whose query holds code. */
    override suspend fun authCallback(url: String) {
        val code = callbackParameter(url, "code") ?: return
        login(code)
    }

    override suspend fun login(username: String, password: String) = login(password)

    suspend fun login(code: String) {
        try {
            val oauth = api.getAccessToken(code)
            interceptor.setAuth(oauth)
            val currentUser = api.getCurrentUser()
            val scoreType = when (currentUser.ratingSteps) {
                1 -> STEP_1
                5 -> STEP_5
                10 -> STEP_10
                20 -> STEP_20
                25 -> STEP_25
                else -> throw Exception("Unknown score step size ${currentUser.ratingSteps}")
            }
            trackPreferences[SCORE_TYPE] = scoreType
            saveDisplayUsername(currentUser.nickname ?: currentUser.preferredUsername ?: currentUser.id)
            saveCredentials("user", oauth.accessToken)
            api.endLogin()
        } catch (e: Throwable) {
            // Core's route tells a refused code from a network failure; a CancellationException goes up too.
            logout()
            throw e
        }
    }

    fun saveOAuth(oauth: MangaBakaOAuth?) {
        saveToken(oauth?.let { trackJson.encodeToString(MangaBakaOAuth.serializer(), it) })
    }

    fun loadOAuth(): MangaBakaOAuth? {
        return try {
            trackJson.decodeFromString(MangaBakaOAuth.serializer(), getToken()!!)
        } catch (_: Exception) {
            null
        }
    }

    override fun logout() {
        super.logout()
        interceptor.setAuth(null)
        api.endLogin()
    }

    override suspend fun delete(track: Track) {
        api.deleteLibManga(track)
    }

    private fun getScoreRange(): IntProgression = when (scoreType()) {
        STEP_1 -> STEP_1_SCORES
        STEP_5 -> STEP_5_SCORES
        STEP_10 -> STEP_10_SCORES
        STEP_20 -> STEP_20_SCORES
        STEP_25 -> STEP_25_SCORES
        else -> throw Exception("Unknown score type")
    }

    companion object {
        const val READING = 1L
        const val COMPLETED = 2L
        const val PAUSED = 3L
        const val DROPPED = 4L
        const val PLAN_TO_READ = 5L
        const val REREADING = 6L
        const val CONSIDERING = 7L

        const val STEP_1 = "STEP_1"
        const val STEP_5 = "STEP_5"
        const val STEP_10 = "STEP_10"
        const val STEP_20 = "STEP_20"
        const val STEP_25 = "STEP_25"

        // 1, 2, ..., 99, 100
        private val STEP_1_SCORES = IntRange(0, 100)

        // 5, 10, ..., 95, 100
        private val STEP_5_SCORES = IntRange(0, 100).step(5)

        // 10, 20, ..., 90, 100
        private val STEP_10_SCORES = IntRange(0, 100).step(10)

        // 20, 40, ..., 80, 100
        private val STEP_20_SCORES = IntRange(0, 100).step(20)

        // 25, 50, 75, 100
        private val STEP_25_SCORES = IntRange(0, 100).step(25)

        private const val SEARCH_ID_PREFIX = "id:"
        private const val SCORE_TYPE = "mangabakaScoreType"
    }
}
