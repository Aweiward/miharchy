package miharchy.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import java.nio.file.Files
import java.util.Collections
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class UpdatesTest {
    private val file = Files.createTempDirectory("updates").resolve("core.db")

    private fun JsonObject.n(k: String) = this[k]!!.jsonPrimitive.int
    private fun JsonObject.running() = this["isRunning"]!!.jsonPrimitive.content == "true"
    private fun cats(vararg ids: Long) = buildJsonObject { put("categories", JsonArray(ids.map(::JsonPrimitive))) }

    private suspend fun Updates.idle(): JsonObject = withTimeout(10_000) { status.first { it is JsonObject && !it.running() }.jsonObject }

    private suspend fun setMeta(db: Database, key: String, value: String) = db.run { c ->
        c.update("INSERT INTO metas (scope, owner, key, value) VALUES ('global', 0, ?, ?) ON CONFLICT (scope, owner, key) DO UPDATE SET value = excluded.value", key, value)
    }

    /** A library manga with [read] read and [unread] unread chapters; returns its id. */
    private suspend fun manga(
        db: Database, title: String, read: Int = 1, unread: Int = 0, status: Int = 1, strategy: Int = 0,
        inLibrary: Boolean = true, source: Long = 7, categories: List<Long> = emptyList(),
    ): Long = db.run { c ->
        val id = c.query(
            "INSERT INTO manga (source_id, remote_url, remote_title, remote_status, remote_update_strategy, user_favorite_at, state_initialized) VALUES (?, ?, ?, ?, ?, ?, 1) RETURNING id",
            source, "/m/$title", title, status, strategy, if (inLibrary) 1_700_000_000_000L else null,
        ) { it.getLong(1) }.single()
        c.batch("INSERT INTO chapter (manga_id, remote_url, remote_name, remote_chapter_number, remote_order, state_date_fetch, user_read) VALUES (?, ?, ?, ?, ?, 0, ?)",
            (0 until read + unread).map { i -> listOf(id, "/m/$title/$i", "Ch. $i", i.toDouble(), i, if (i < read) 1 else 0) })
        c.batch("INSERT INTO manga_category (manga_id, category_id) VALUES (?, ?)", categories.map { listOf(id, it) })
        id
    }

    private suspend fun category(db: Database, name: String, include: String): Long = db.run { c ->
        c.query("INSERT INTO category (name, `order`, include_in_update) VALUES (?, (SELECT max(`order`) + 1 FROM category), ?) RETURNING id", name, include) { it.getLong(1) }.single()
    }

    @Test
    fun aRunPicksTheMangaTheFiltersAndCategoriesLeave() = runBlocking {
        Database(file).use { db ->
            val excluded = category(db, "Dropped", "EXCLUDE")
            val done = manga(db, "Done")
            manga(db, "Unread", unread = 2)
            manga(db, "Completed", status = 2)
            manga(db, "Not started", read = 0)
            manga(db, "Once", strategy = 1)
            manga(db, "Elsewhere", inLibrary = false)
            val dropped = manga(db, "Dropped one", categories = listOf(excluded))
            val both = manga(db, "Both", categories = listOf(category(db, "Reading", "UNSET"), excluded))
            val refreshed = Collections.synchronizedList(mutableListOf<Long>())
            Updates(db, { id, _ -> refreshed += id }, tick = 3_600_000).use { u ->
                fun counts(s: JsonObject) = listOf(s.n("totalJobs"), s.n("skippedMangasCount"))
                // Settings.js's defaults: all three skip filters on.
                assertEquals(listOf(1, 5), counts(u.routes.call("update.start")))
                assertEquals(listOf(1, 1, 5), u.idle().let { listOf(it.n("finishedJobs")) + counts(it) })
                assertEquals(listOf(done), refreshed)

                // Off, the update strategy and an EXCLUDE category skip; a manga only in an EXCLUDE category is not in the run at all.
                for (k in listOf("excludeUnreadChapters", "excludeNotStarted", "excludeCompleted")) setMeta(db, "miharchy.$k", "false")
                assertEquals(listOf(4, 2), counts(u.routes.call("update.start")))
                u.idle()
                // Named categories update every manga in them; Default (0) holds the manga with none.
                refreshed.clear()
                assertEquals(listOf(2, 0), counts(u.routes.call("update.start", cats(excluded))))
                u.idle()
                assertEquals(listOf(both, dropped), refreshed)
                assertEquals(listOf(4, 1), counts(u.routes.call("update.start", cats(0))))
                u.idle()
                u.routes.expect(Kind.notFound, "update.start", cats(999))

                // Once a category is INCLUDE, the whole library is only the included ones.
                val picked = category(db, "Picked", "INCLUDE")
                val chosen = manga(db, "Chosen", categories = listOf(picked))
                refreshed.clear()
                assertEquals(listOf(1, 0), counts(u.routes.call("update.start")))
                u.idle()
                assertEquals(listOf(chosen), refreshed)
            }
        }
    }

    @Test
    fun aStopKeepsTheCountsAndAFailureDoesNotEndTheRun() = runBlocking {
        Database(file).use { db ->
            val bad = manga(db, "A bad one", source = 1)
            manga(db, "B fine", source = 1)
            val held = manga(db, "C held", source = 2)
            val gate = CompletableDeferred<Unit>()
            val reached = CompletableDeferred<Unit>()
            Updates(db, { id, _ ->
                when (id) {
                    bad -> throw ApiError(Kind.network, "The site answered HTTP 500.")
                    // As Host.call did once: a stop that comes back as a source error.
                    held -> { reached.complete(Unit); try { gate.await() } catch (e: CancellationException) { throw ApiError(Kind.source, "JobCancellationException: wrapped") } }
                    else -> {}
                }
            }, tick = 3_600_000).use { u ->
                val first = u.routes.call("update.start")
                assertEquals("true", first["started"].toString())
                assertTrue(first.running())
                reached.await()
                // Source 1's two manga finish while source 2 waits; the bad one fails and the run goes on.
                val mid = withTimeout(10_000) { u.status.first { (it as JsonObject).n("finishedJobs") == 2 }.jsonObject }
                assertTrue(mid.running())
                val failed = mid["failed"]!!.jsonArray.single().jsonObject
                assertEquals(listOf(bad.toString(), "network"), listOf(failed["mangaId"].toString(), failed["kind"]!!.jsonPrimitive.content))
                // One run at a time.
                assertEquals("false", u.routes.call("update.start")["started"].toString())
                u.routes.expect(Kind.notFound, "update.start", cats(999))

                val stopped = u.routes.call("update.stop")
                assertEquals(listOf(false, 2, 3), listOf(stopped.running(), stopped.n("finishedJobs"), stopped.n("totalJobs")))
                assertEquals("true", stopped["stopped"].toString(), "a client tells a stop from an end")
                assertEquals(1, stopped["failed"]!!.jsonArray.size, "a stop keeps the run's counts and reasons")
                assertEquals(stopped, u.routes.call("update.status"))
                val at = stopped["lastUpdateTimestamp"]!!.jsonPrimitive.long
                assertTrue(at > 1_700_000_000_000L, "lastUpdateTimestamp is in ms")

                // A new run starts the counts again.
                gate.complete(Unit)
                assertEquals("true", u.routes.call("update.start")["started"].toString())
                val ended = u.idle()
                assertEquals(listOf("3", "false"), listOf(ended["finishedJobs"].toString(), ended["stopped"].toString()))
            }
            // The last run's time survives a restart.
            Updates(db, { _, _ -> }, tick = 3_600_000).use { u -> assertTrue(u.routes.call("update.status")["lastUpdateTimestamp"]!!.jsonPrimitive.long > 0) }
        }
    }

    @Test
    fun theScheduleRunsTheLibraryAndZeroTurnsItOff() = runBlocking {
        Database(file).use { db ->
            manga(db, "Done")
            setMeta(db, "miharchy.globalUpdateInterval", "0")
            val runs = Collections.synchronizedList(mutableListOf<Long>())
            // An hour of 1 ms: an interval of 50 is 50 ms.
            Updates(db, { id, _ -> runs += id }, hour = 1, tick = 10).use { u ->
                delay(300)
                assertEquals(0, runs.size, "0 is off")
                setMeta(db, "miharchy.globalUpdateInterval", "50")
                withTimeout(10_000) { u.status.first { (it as JsonObject).n("finishedJobs") == 1 } }
                assertTrue(u.routes.call("update.status")["lastUpdateTimestamp"]!!.jsonPrimitive.long > 0)
                // The next run waits an interval from the last one.
                withTimeout(10_000) { while (runs.size < 2) delay(10) }
            }
        }
    }
}
