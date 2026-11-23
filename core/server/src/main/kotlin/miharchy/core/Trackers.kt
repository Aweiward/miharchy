package miharchy.core

import eu.kanade.tachiyomi.data.track.BaseTracker
import eu.kanade.tachiyomi.data.track.TrackerPrefs
import eu.kanade.tachiyomi.data.track.model.Track
import eu.kanade.tachiyomi.data.track.model.TrackSearch
import eu.kanade.tachiyomi.network.HttpException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.io.IOException
import java.sql.Connection
import java.sql.ResultSet
import java.util.concurrent.ConcurrentHashMap

/**
 * Each tracker's login state in `tracker_pref` (0006-tracks.sql), read once and written through. It holds tokens,
 * so it stays in core.db, in core's owner-only data folder, and no route returns it.
 */
class TrackerStore(private val db: Database) {
    private val values = ConcurrentHashMap<Long, ConcurrentHashMap<String, String>>()

    init {
        runBlocking {
            db.run { c -> c.query("SELECT tracker_id, key, value FROM tracker_pref") { Triple(it.getLong(1), it.getString(2), it.getString(3)) } }
        }.forEach { (id, k, v) -> values.getOrPut(id) { ConcurrentHashMap() }[k] = v }
    }

    /** Writes run on the caller's thread, an OkHttp or IO thread, never the database's own. */
    fun of(trackerId: Long): TrackerPrefs = object : TrackerPrefs {
        private val map get() = values.getOrPut(trackerId) { ConcurrentHashMap() }
        override fun get(key: String) = map[key]
        override fun set(key: String, value: String) {
            map[key] = value
            runBlocking { db.run { c -> c.update("INSERT INTO tracker_pref (tracker_id, key, value) VALUES (?, ?, ?) ON CONFLICT (tracker_id, key) DO UPDATE SET value = excluded.value", trackerId, key, value) } }
        }
        override fun delete(key: String) {
            map.remove(key)
            runBlocking { db.run { c -> c.update("DELETE FROM tracker_pref WHERE tracker_id = ? AND key = ?", trackerId, key) } }
        }
    }
}

/**
 * Trackers (#371, ADR 0010): logins, searches, a manga's tracks, and progress pushes, as Suwayomi's `Track.kt`
 * does them with Mihon's tracker clients. A track's reply keeps Suwayomi's TrackRecord fields; dates are in ms.
 */
class Trackers(private val db: Database, trackers: List<BaseTracker>) {
    private val byId = trackers.associateBy { it.id }
    // One login, logout or token use at a time per tracker, so a refresh never races another.
    private val locks = byId.mapValues { Mutex() }
    // Search results, so a bind takes the title and chapter count the user picked, as Suwayomi's TrackSearchTable.
    private val found = object : LinkedHashMap<Pair<Long, Long>, TrackSearch>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Pair<Long, Long>, TrackSearch>) = size > 500
    }

    val routes: Map<String, Route> = mapOf(
        "tracker.list" to { _ -> buildJsonObject { put("trackers", JsonArray(byId.values.map(::trackerJson))) } },
        "tracker.login" to { input -> login(input) },
        "tracker.logout" to { input ->
            val t = tracker(input)
            locked(t) { t.logout() }
            buildJsonObject { put("tracker", trackerJson(t)) }
        },
        "track.search" to { input -> search(input) },
        "track.bind" to { input -> bind(input) },
        "track.update" to { input -> update(input) },
        "track.unbind" to { input ->
            val id = input.long("recordId")
            val gone = db.run { c -> c.update("DELETE FROM manga_track WHERE id = ?", id) }
            if (gone == 0) throw ApiError(Kind.notFound, "There is no track $id.")
            buildJsonObject { put("deleted", id) }
        },
        "track.list" to { input -> buildJsonObject { put("tracks", JsonArray(tracksOf(input.longs("mangaIds")).map(::recordJson))) } },
        "track.progress" to { input -> progress(input.longs("mangaIds")) },
    )

    private fun tracker(input: JsonObject): BaseTracker {
        val id = input.long("trackerId")
        return byId[id] ?: throw ApiError(Kind.notFound, "There is no tracker $id.")
    }

    private fun loggedIn(id: Long): BaseTracker {
        val t = byId[id] ?: throw ApiError(Kind.notFound, "There is no tracker $id.")
        if (!t.isLoggedIn) throw ApiError(Kind.invalid, "Log in to ${t.name} first.")
        return t
    }

    private suspend fun <T> locked(t: BaseTracker, block: suspend () -> T): T = locks.getValue(t.id).withLock { remote(t, block) }

    /** A tracker's failure in ADR 0010's kinds; never `unauthorized`, which is core's own secret. */
    private suspend fun <T> remote(t: BaseTracker, block: suspend () -> T): T = try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (e: ApiError) {
        throw e
    } catch (e: HttpException) {
        throw ApiError(Kind.network, "${t.name} answered HTTP ${e.code}.")
    } catch (e: IOException) {
        throw ApiError(Kind.network, "${t.name}: ${e.message ?: e::class.java.simpleName}")
    } catch (e: SerializationException) {
        // Its message quotes the reply, which can be a token.
        throw ApiError(Kind.source, "${t.name} sent an unexpected reply.")
    } catch (e: Exception) {
        throw ApiError(Kind.source, "${t.name}: ${e.message ?: e::class.java.simpleName}")
    } catch (e: NotImplementedError) {
        // The ports throw it for a status or score they do not know.
        throw ApiError(Kind.source, "${t.name}: ${e.message}")
    }

    private fun trackerJson(t: BaseTracker) = buildJsonObject {
        put("id", t.id)
        put("name", t.name)
        put("isLoggedIn", t.isLoggedIn)
        // Asked for on each list, and the same until the login ends (MyAnimeList's PKCE verifier stays).
        put("authUrl", if (t.isLoggedIn) null else t.authUrl())
        put("scores", JsonArray(t.getScoreList().map(::JsonPrimitive)))
        put("statuses", JsonArray(t.getStatusList().map { s -> buildJsonObject { put("value", s); put("name", t.getStatus(s)) } }))
        put("supportsReadingDates", t.supportsReadingDates)
        put("supportsPrivateTracking", t.supportsPrivateTracking)
    }

    /**
     * `{ trackerId, callbackUrl }` for OAuth, or `{ trackerId, username, password }`. Neither comes back in any reply.
     * A refused login is `invalid`, never `unauthorized`, which means core's own secret was wrong.
     */
    private suspend fun login(input: JsonObject): JsonObject {
        val t = tracker(input)
        val callback = input.text("callbackUrl")
        val username = input.text("username")
        val password = input.text("password")
        if (callback == null && (username == null || password == null)) throw ApiError(Kind.invalid, "The request needs callbackUrl, or username and password.")
        locks.getValue(t.id).withLock {
            try {
                if (callback != null) t.authCallback(callback) else t.login(username!!, password!!)
            } catch (e: CancellationException) {
                throw e
            } catch (e: HttpException) {
                if (e.code >= 500) throw ApiError(Kind.network, "${t.name} answered HTTP ${e.code}.")
                if (t.isLoggedIn) t.logout()
            } catch (e: IOException) {
                throw ApiError(Kind.network, "${t.name}: ${e.message ?: e::class.java.simpleName}")
            } catch (e: Exception) {
                if (t.isLoggedIn) t.logout()
            } catch (e: NotImplementedError) {
                if (t.isLoggedIn) t.logout()
            }
        }
        if (!t.isLoggedIn) throw ApiError(Kind.invalid, "${t.name} did not accept the login.")
        return buildJsonObject { put("tracker", trackerJson(t)) }
    }

    private suspend fun search(input: JsonObject): JsonObject {
        val t = loggedIn(input.long("trackerId"))
        val query = input.text("query") ?: throw ApiError(Kind.invalid, "The request needs query, a string.")
        val results = locked(t) { t.search(query) }
        synchronized(found) { results.forEach { found[t.id to it.remote_id] = it } }
        return buildJsonObject {
            put("results", JsonArray(results.map { s ->
                buildJsonObject {
                    put("remoteId", s.remote_id); put("title", s.title); put("totalChapters", s.total_chapters)
                    put("trackingUrl", s.tracking_url); put("coverUrl", s.cover_url); put("summary", s.summary)
                    put("publishingStatus", s.publishing_status); put("publishingType", s.publishing_type); put("startDate", s.start_date)
                    put("score", s.score)
                }
            }))
        }
    }

    /** Suwayomi's `Track.bind`: the tracker's own entry wins, then the manga's read chapters move it on. */
    private suspend fun bind(input: JsonObject): JsonObject {
        if ("recordId" in input) return copy(input.long("mangaId"), input.long("recordId"))
        val t = loggedIn(input.long("trackerId"))
        val mangaId = input.long("mangaId")
        val remoteId = input.long("remoteId")
        if (db.run { c -> c.query("SELECT 1 FROM manga WHERE id = ?", mangaId) { 1 } }.isEmpty()) throw ApiError(Kind.notFound, "There is no manga $mangaId.")
        val known = synchronized(found) { found[t.id to remoteId] }
            ?: db.run { c -> c.query("$SELECT WHERE tracker_id = ? AND remote_id = ? LIMIT 1", t.id, remoteId, map = ::row).firstOrNull() }
            ?: throw ApiError(Kind.notFound, "Search ${t.name} for this manga first.")
        val track = Track.create(t.id).apply {
            manga_id = mangaId
            remote_id = remoteId
            title = known.title
            total_chapters = known.total_chapters
            tracking_url = known.tracking_url
            private = (input["private"] as? JsonPrimitive)?.booleanOrNull ?: false
        }
        val (top, firstRead) = db.run { c -> maxRead(c, mangaId) to firstReadAt(c, mangaId) }
        locked(t) { t.bind(track, top != null) }
        track.id = save(track)
        val chapter = top?.takeIf { it > 0 && it > track.last_chapter_read }
        val start = if (track.started_reading_date <= 0) firstRead else null
        if (chapter == null && start == null) return buildJsonObject { put("track", recordJson(track)) }
        return change(t, track, buildJsonObject {
            chapter?.let { put("lastChapterRead", it) }
            start?.let { put("startDate", it) }
        })
    }

    /**
     * Migrate's form, Suwayomi's `bindTrackRecord`: the record's remote entry and personal fields copied onto [mangaId],
     * replacing that manga's own record on the same tracker. It calls no tracker, so it needs no login and pushes nothing.
     */
    private suspend fun copy(mangaId: Long, recordId: Long): JsonObject = db.run { c ->
        c.transaction {
            if (c.query("SELECT 1 FROM manga WHERE id = ?", mangaId) { 1 }.isEmpty()) throw ApiError(Kind.notFound, "There is no manga $mangaId.")
            if (c.query("SELECT 1 FROM manga_track WHERE id = ?", recordId) { 1 }.isEmpty()) throw ApiError(Kind.notFound, "There is no track $recordId.")
            c.update(
                """INSERT OR REPLACE INTO manga_track (manga_id, tracker_id, remote_id, remote_url, library_id, title, last_chapter_read,
                       total_chapters, status, score, start_date, finish_date, private)
                   SELECT ?, tracker_id, remote_id, remote_url, library_id, title, last_chapter_read, total_chapters, status, score,
                       start_date, finish_date, private FROM manga_track WHERE id = ?""",
                mangaId, recordId,
            )
            val track = c.query("$SELECT WHERE manga_id = ? AND tracker_id = (SELECT tracker_id FROM manga_track WHERE id = ?)", mangaId, recordId, map = ::row).single()
            buildJsonObject { put("track", recordJson(track)) }
        }
    }

    private suspend fun update(input: JsonObject): JsonObject {
        val id = input.long("recordId")
        val track = db.run { c -> c.query("$SELECT WHERE id = ?", id, map = ::row).firstOrNull() } ?: throw ApiError(Kind.notFound, "There is no track $id.")
        return change(loggedIn(track.tracker_id), track, input)
    }

    /** Suwayomi's `Track.update`: { status?, lastChapterRead?, scoreString?, startDate?, finishDate?, private? }. */
    private suspend fun change(t: BaseTracker, track: Track, input: JsonObject): JsonObject {
        (input["status"] as? JsonPrimitive)?.longOrNull?.let { status ->
            if (status !in t.getStatusList()) throw ApiError(Kind.invalid, "${t.name} has no status $status.")
            track.status = status
            if (status == t.getCompletionStatus() && track.total_chapters != 0L) track.last_chapter_read = track.total_chapters.toDouble()
        }
        (input["lastChapterRead"] as? JsonPrimitive)?.doubleOrNull?.let { read ->
            if (track.last_chapter_read == 0.0 && track.last_chapter_read < read && track.status != t.getRereadingStatus()) track.status = t.getReadingStatus()
            track.last_chapter_read = read
            if (track.total_chapters != 0L && read.toInt().toLong() == track.total_chapters) {
                track.status = t.getCompletionStatus()
                track.finished_reading_date = System.currentTimeMillis()
            }
        }
        input.text("scoreString")?.let { score ->
            val index = t.getScoreList().indexOf(score)
            if (index < 0) throw ApiError(Kind.invalid, "$score is not one of ${t.name}'s scores.")
            track.score = t.indexToScore(index)
        }
        (input["startDate"] as? JsonPrimitive)?.longOrNull?.let { track.started_reading_date = it }
        (input["finishDate"] as? JsonPrimitive)?.longOrNull?.let { track.finished_reading_date = it }
        (input["private"] as? JsonPrimitive)?.booleanOrNull?.let { track.private = it }
        locked(t) { t.update(track) }
        save(track)
        return buildJsonObject { put("track", recordJson(track)) }
    }

    /**
     * Suwayomi's `trackChapter`: each track of each manga takes the highest read chapter number when it is above
     * the tracker's own, read fresh first. A failed track is reported and the rest go on.
     */
    private suspend fun progress(mangaIds: List<Long>): JsonObject {
        val failed = mutableListOf<JsonObject>()
        for (mangaId in mangaIds.distinct()) {
            val chapter = db.run { c -> maxRead(c, mangaId) }?.takeIf { it > 0 } ?: continue
            for (track in tracksOf(listOf(mangaId))) {
                if (track.last_chapter_read == chapter) continue
                val t = byId[track.tracker_id]?.takeIf { it.isLoggedIn } ?: continue
                try {
                    locked(t) { t.refresh(track) }
                    save(track)
                    if (chapter > track.last_chapter_read) {
                        track.last_chapter_read = chapter
                        locked(t) { t.update(track, true) }
                        save(track)
                    }
                } catch (e: ApiError) {
                    failed += buildJsonObject { put("recordId", track.id); put("kind", e.kind.name); put("message", e.message) }
                }
            }
        }
        return buildJsonObject {
            put("tracks", JsonArray(tracksOf(mangaIds).map(::recordJson)))
            put("failed", JsonArray(failed))
        }
    }

    private suspend fun tracksOf(mangaIds: List<Long>): List<Track> =
        db.run { c -> c.query("$SELECT WHERE ${among("manga_id")} ORDER BY manga_id, tracker_id", idList(mangaIds), map = ::row) }

    private suspend fun save(track: Track): Long = db.run { c ->
        c.query(
            """INSERT INTO manga_track (manga_id, tracker_id, remote_id, remote_url, library_id, title, last_chapter_read, total_chapters,
                 status, score, start_date, finish_date, private) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (manga_id, tracker_id) DO UPDATE SET remote_id = excluded.remote_id, remote_url = excluded.remote_url,
                 library_id = excluded.library_id, title = excluded.title, last_chapter_read = excluded.last_chapter_read,
                 total_chapters = excluded.total_chapters, status = excluded.status, score = excluded.score,
                 start_date = excluded.start_date, finish_date = excluded.finish_date, private = excluded.private
               RETURNING id""",
            track.manga_id, track.tracker_id, track.remote_id, track.tracking_url, track.library_id, track.title, track.last_chapter_read,
            track.total_chapters, track.status, track.score, track.started_reading_date, track.finished_reading_date, if (track.private) 1 else 0,
        ) { it.getLong(1) }.single()
    }.also { track.id = it }

    private fun recordJson(t: Track): JsonObject = buildJsonObject {
        put("id", t.id); put("mangaId", t.manga_id); put("trackerId", t.tracker_id); put("remoteId", t.remote_id); put("libraryId", t.library_id)
        put("title", t.title); put("status", t.status); put("score", t.score)
        put("displayScore", byId[t.tracker_id]?.let { runCatching { it.displayScore(t) }.getOrNull() } ?: t.score.toString())
        put("lastChapterRead", t.last_chapter_read); put("totalChapters", t.total_chapters); put("remoteUrl", t.tracking_url)
        put("startDate", t.started_reading_date); put("finishDate", t.finished_reading_date); put("private", t.private)
    }

    private companion object {
        const val SELECT = """SELECT id, manga_id, tracker_id, remote_id, remote_url, library_id, title, last_chapter_read, total_chapters,
            status, score, start_date, finish_date, private FROM manga_track"""

        fun row(r: ResultSet) = Track().apply {
            id = r.getLong(1); manga_id = r.getLong(2); tracker_id = r.getLong(3); remote_id = r.getLong(4); tracking_url = r.getString(5)
            library_id = r.getObject(6)?.let { r.getLong(6) }; title = r.getString(7); last_chapter_read = r.getDouble(8)
            total_chapters = r.getLong(9); status = r.getLong(10); score = r.getDouble(11)
            started_reading_date = r.getLong(12); finished_reading_date = r.getLong(13); private = r.getInt(14) == 1
        }

        // A null row ends [query]'s list, so these aggregates take firstOrNull.
        /** The highest read chapter number, or null with none read. */
        fun maxRead(c: Connection, mangaId: Long): Double? =
            c.query("SELECT max(remote_chapter_number) FROM chapter WHERE manga_id = ? AND user_read = 1", mangaId) { r -> r.getDouble(1).takeIf { !r.wasNull() } }.firstOrNull()

        /** When the manga's first read chapter was read, in ms, or null. */
        fun firstReadAt(c: Connection, mangaId: Long): Long? =
            c.query("SELECT min(h.read_at) FROM history h JOIN chapter ch ON ch.id = h.chapter_id WHERE ch.manga_id = ? AND ch.user_read = 1 AND h.read_at > 0", mangaId) { r ->
                r.getLong(1).takeIf { !r.wasNull() }
            }.firstOrNull()
    }
}

private fun JsonObject.text(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
