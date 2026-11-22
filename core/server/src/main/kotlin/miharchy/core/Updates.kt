package miharchy.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Library update runs (#368, ADR 0010): [refresh] fetches each manga's chapters, one source at a time per source and up
 * to [SOURCES] sources at once, as Suwayomi's `Updater`. Every route answers with the status,
 * `{ isRunning, finishedJobs, totalJobs, skippedMangasCount, lastUpdateTimestamp (ms), failed: [{ mangaId, kind, message }] }`,
 * and the `updates` topic sends it on each change. Unlike Suwayomi, a stop keeps the counts until the next run.
 *
 * The choices are the window's global metas (`miharchy.<Settings key>`), with `Settings.js`'s defaults, until Settings
 * moves to core (#385): the three skip filters and `globalUpdateInterval` in hours, 0 for off. [hour] and [tick] are
 * there for tests. ponytail: no auto-download of new chapters and no `updateMangas` (a refresh always fetches details).
 */
class Updates(private val db: Database, private val refresh: suspend (Long) -> Unit, private val hour: Long = 3_600_000, tick: Long = 60_000) : AutoCloseable {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    // Starts and stops one at a time; the counts change under [lock], from several sources at once.
    private val ops = Mutex()
    private val lock = Any()
    @Volatile private var job: Job? = null
    private var running = false
    private var total = 0
    private var finished = 0
    private var skipped = 0
    private val failed = mutableListOf<JsonObject>()
    @Volatile private var last = 0L
    // With no run yet, the schedule counts from core's start, as Suwayomi's first scheduling waits one interval.
    private val born = System.currentTimeMillis()
    private val state = MutableStateFlow<JsonElement>(JsonNull)

    /** The status: the whole of it on subscribe, then each change. */
    val status: StateFlow<JsonElement> get() = state

    init {
        last = runBlocking { setting(LAST)?.toLongOrNull() ?: 0 }
        publish()
        scope.launch {
            while (true) {
                delay(tick)
                try { scheduled() } catch (e: CancellationException) { throw e } catch (e: Exception) { e.printStackTrace() }
            }
        }
    }

    val routes: Map<String, Route> = mapOf(
        "update.status" to { _ -> statusJson() },
        // categories: ids to update, every manga in them; none or [] is the whole library, by each category's includeInUpdate.
        "update.start" to { input -> start((input["categories"] as? JsonArray)?.let { input.longs("categories") }?.takeIf { it.isNotEmpty() }) },
        "update.stop" to { _ ->
            ops.withLock {
                job?.cancelAndJoin()
                synchronized(lock) { running = false }
            }
            publish()
            statusJson()
        },
    )

    override fun close() = scope.cancel()

    private suspend fun scheduled() {
        val hours = setting("miharchy.globalUpdateInterval")?.toDoubleOrNull() ?: 12.0
        if (hours > 0 && System.currentTimeMillis() - (if (last > 0) last else born) >= hours * hour) start(null)
    }

    /** `started` says whether this call began the run; one runs at a time. */
    private suspend fun start(categories: List<Long>?): JsonObject {
        val began = ops.withLock {
            // Unknown categories fail even while a run goes.
            val (todo, skip) = select(categories)
            if (job?.isActive == true) return@withLock false
            val now = System.currentTimeMillis()
            db.run { c ->
                c.update("INSERT INTO metas (scope, owner, key, value) VALUES ('global', 0, ?, ?) ON CONFLICT (scope, owner, key) DO UPDATE SET value = excluded.value", LAST, now.toString())
            }
            synchronized(lock) { last = now; running = true; total = todo.size; finished = 0; skipped = skip; failed.clear() }
            publish()
            job = scope.launch { work(todo) }
            true
        }
        return JsonObject(statusJson() + ("started" to JsonPrimitive(began)))
    }

    private suspend fun work(todo: List<Pair<Long, Long>>) {
        try {
            val permits = Semaphore(SOURCES)
            coroutineScope {
                for (ids in todo.groupBy({ it.second }, { it.first }).values) launch { permits.withPermit { ids.forEach { one(it) } } }
            }
        } finally {
            withContext(NonCancellable) { synchronized(lock) { running = false }; publish() }
        }
    }

    /** A failed manga counts as finished, with its reason, and the run goes on. */
    private suspend fun one(id: Long) {
        val error = try {
            refresh(id)
            null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // A refresh that wraps a stop in its own error is still a stop, never a failure.
            currentCoroutineContext().ensureActive()
            (e as? ApiError)?.let { it.kind to it.message.orEmpty() } ?: (Kind.`internal` to "${e::class.java.simpleName}: ${e.message}")
        }
        synchronized(lock) {
            finished++
            if (error != null) failed += buildJsonObject { put("mangaId", id); put("kind", error.first.name); put("message", error.second) }
        }
        publish()
    }

    /**
     * The library manga to update, with their sources, and how many were skipped. With [categories], every manga in them;
     * without, Mihon's `LibraryUpdateJob` rule: the INCLUDE categories, or the UNSET ones when none is, and never a manga
     * in an EXCLUDE one. Both then drop what Suwayomi's skip filters drop (`Updater.addCategoriesToUpdateQueue`).
     */
    private suspend fun select(categories: List<Long>?): Pair<List<Pair<Long, Long>>, Int> {
        val skipUnread = flag("excludeUnreadChapters")
        val skipNotStarted = flag("excludeNotStarted")
        val skipCompleted = flag("excludeCompleted")
        return db.run { c ->
            val cats = c.query("SELECT id, include_in_update FROM category") { it.getLong(1) to it.getString(2) }.toMap()
            categories?.firstOrNull { it !in cats }?.let { throw ApiError(Kind.notFound, "There is no category $it.") }
            val chosen = categories?.toSet() ?: cats.filterValues { it == "INCLUDE" }.keys.ifEmpty { cats.filterValues { it == "UNSET" }.keys }
            val excluded = if (categories == null) cats.filterValues { it == "EXCLUDE" }.keys else emptySet()
            val inCats = c.query("SELECT manga_id, category_id FROM manga_category") { it.getLong(1) to it.getLong(2) }
                .groupBy({ it.first }, { it.second })
            val candidates = c.query(
                """SELECT m.id, m.source_id, m.remote_update_strategy, m.remote_status, m.state_initialized,
                          count(ch.id), coalesce(sum(ch.user_read = 0), 0),
                          coalesce((SELECT max(h.read_at) FROM history h WHERE h.manga_id = m.id), 0)
                   FROM manga m LEFT JOIN chapter ch ON ch.manga_id = m.id
                   WHERE m.user_favorite_at IS NOT NULL GROUP BY m.id ORDER BY m.remote_title COLLATE NOCASE""",
            ) { r -> Candidate(r.getLong(1), r.getLong(2), r.getInt(3), r.getInt(4), r.getInt(5) == 1, r.getInt(6), r.getInt(7), r.getLong(8)) }
                .filter { m -> (inCats[m.id] ?: listOf(0L)).any { it in chosen } }
            val todo = candidates.filter { m ->
                m.strategy == 0 &&
                    (!skipUnread || m.unread == 0) &&
                    // Marking chapters read sets no read time, so a read chapter counts as started too.
                    (!skipNotStarted || !m.initialized || m.lastReadAt > 0 || m.chapters > m.unread) &&
                    (!skipCompleted || m.status != COMPLETED) &&
                    (inCats[m.id] ?: listOf(0L)).none { it in excluded }
            }
            todo.map { it.id to it.source } to candidates.size - todo.size
        }
    }

    private class Candidate(
        val id: Long, val source: Long, val strategy: Int, val status: Int, val initialized: Boolean,
        val chapters: Int, val unread: Int, val lastReadAt: Long,
    )

    private suspend fun flag(key: String) = setting("miharchy.$key")?.let { it == "true" } ?: true

    private suspend fun setting(key: String): String? = db.run { c ->
        c.query("SELECT value FROM metas WHERE scope = 'global' AND owner = 0 AND key = ?", key) { it.getString(1) }.firstOrNull()
    }

    private fun publish() {
        synchronized(lock) { state.value = statusJson() }
    }

    private fun statusJson(): JsonObject = synchronized(lock) {
        buildJsonObject {
            put("isRunning", running); put("finishedJobs", finished); put("totalJobs", total); put("skippedMangasCount", skipped)
            put("lastUpdateTimestamp", last)
            put("failed", JsonArray(failed.toList()))
        }
    }

    private companion object {
        const val SOURCES = 5
        const val COMPLETED = 2
        // The start of the last run, kept so the schedule survives a restart; Suwayomi's lastUpdateTimestamp.
        const val LAST = "miharchy.lastUpdateTimestamp"
    }
}
