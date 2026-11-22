// Ported from mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026
// app/src/main/java/eu/kanade/tachiyomi/data/track/Tracker.kt, BaseTracker.kt and DeletableTracker.kt
// Licensed under Apache-2.0. Changes: Mihon's interface and base class are one class; Android resources, toasts,
// flows and dependency injection are gone; TrackPreferences is [TrackerPrefs], kept by core; the setRemote* calls
// live in core's routes (miharchy.core.Trackers), as Suwayomi's; [authUrl] and [authCallback] carry the OAuth
// logins that Mihon's TrackLoginActivity parses.

package eu.kanade.tachiyomi.data.track

import eu.kanade.tachiyomi.data.track.model.Track
import eu.kanade.tachiyomi.data.track.model.TrackSearch
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient

/** One tracker's saved state: Mihon's TrackPreferences for that tracker. Core keeps it in core.db. */
interface TrackerPrefs {
    operator fun get(key: String): String?
    operator fun set(key: String, value: String)
    fun delete(key: String)
}

abstract class BaseTracker(
    val id: Long,
    val name: String,
    /** The client every request goes through; tests point it at a local server. */
    open val client: OkHttpClient,
    protected val trackPreferences: TrackerPrefs,
) {
    // Application and remote support for reading dates
    open val supportsReadingDates: Boolean = false

    open val supportsPrivateTracking: Boolean = false

    abstract fun getStatusList(): List<Long>

    /** The status's name, Mihon's English string for it. */
    abstract fun getStatus(status: Long): String?

    abstract fun getReadingStatus(): Long

    abstract fun getRereadingStatus(): Long

    abstract fun getCompletionStatus(): Long

    abstract fun getScoreList(): List<String>

    // TODO: Store all scores as 10 point in the future maybe?
    open fun get10PointScore(track: Track): Double {
        return track.score
    }

    open fun indexToScore(index: Int): Double {
        return index.toDouble()
    }

    abstract fun displayScore(track: Track): String

    abstract suspend fun update(track: Track, didReadChapter: Boolean = false): Track

    abstract suspend fun bind(track: Track, hasReadChapters: Boolean = false): Track

    abstract suspend fun search(query: String): List<TrackSearch>

    abstract suspend fun refresh(track: Track): Track

    abstract suspend fun login(username: String, password: String)

    /** An OAuth tracker's login address, which the user opens; null for a username and password login. */
    open fun authUrl(): String? = null

    /** The address the browser ends on after the user allows access to an OAuth tracker. */
    open suspend fun authCallback(url: String) {
        throw UnsupportedOperationException("$name logs in with a username and password.")
    }

    open fun logout() {
        saveCredentials("", "")
    }

    val isLoggedIn: Boolean
        get() = getUsername().isNotEmpty() &&
            getPassword().isNotEmpty()

    fun getUsername() = trackPreferences[USERNAME] ?: ""

    fun getPassword() = trackPreferences[PASSWORD] ?: ""

    fun getDisplayUsername(): String = trackPreferences[DISPLAY_USERNAME] ?: ""

    fun saveDisplayUsername(displayName: String) {
        trackPreferences[DISPLAY_USERNAME] = displayName
    }

    fun saveCredentials(username: String, password: String) {
        trackPreferences[USERNAME] = username
        trackPreferences[PASSWORD] = password
    }

    /** Mihon's trackToken: the tracker's OAuth object as JSON. */
    fun getToken(): String? = trackPreferences[TOKEN]?.takeIf { it.isNotEmpty() }

    fun saveToken(json: String?) {
        if (json == null) trackPreferences.delete(TOKEN) else trackPreferences[TOKEN] = json
    }

    companion object {
        const val USERNAME = "username"
        const val PASSWORD = "password"
        const val DISPLAY_USERNAME = "displayUsername"
        const val TOKEN = "token"

        /** A query parameter of an OAuth callback address, in its query or its fragment. */
        fun callbackParameter(url: String, key: String): String? {
            val parsed = runCatching { url.trim().toHttpUrl() }.getOrNull() ?: return null
            parsed.queryParameter(key)?.let { return it }
            val fragment = parsed.fragment ?: return null
            return "http://x/?$fragment".toHttpUrl().queryParameter(key)
        }
    }
}

/** A tracker that can also remove an entry from the user's list; core's unbind keeps the entry, as Miharchy does. */
interface DeletableTracker {
    suspend fun delete(track: Track)
}
