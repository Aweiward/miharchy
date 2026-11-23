package miharchy.core

import eu.kanade.tachiyomi.data.track.BaseTracker
import eu.kanade.tachiyomi.data.track.TrackerPrefs
import eu.kanade.tachiyomi.data.track.anilist.Anilist
import eu.kanade.tachiyomi.data.track.model.Track
import eu.kanade.tachiyomi.data.track.model.TrackSearch
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.nio.file.Files
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.test.fail

class TrackersTest {
    private val work = Files.createTempDirectory("trackers")
    private val file = work.resolve("core.db")

    private fun obj(vararg pairs: Pair<String, Any>) = buildJsonObject {
        for ((k, v) in pairs) put(k, when (v) {
            is JsonElement -> v
            is Boolean -> JsonPrimitive(v)
            is Number -> JsonPrimitive(v)
            is List<*> -> JsonArray(v.map { JsonPrimitive(it as Number) })
            else -> JsonPrimitive(v.toString())
        })
    }
    private fun JsonElement.o() = jsonObject
    private fun JsonObject.track() = this["track"]!!.jsonObject
    private fun JsonObject.n(k: String) = this[k]!!.jsonPrimitive.double

    private suspend fun Map<String, Route>.fails(name: String, input: JsonObject): ApiError =
        try { getValue(name)(input); fail("$name should fail") } catch (e: ApiError) { e }

    /** A manga with chapters 1..[chapters], the first [read] of them read, the first one read at [readAt]. */
    private suspend fun manga(db: Database, chapters: Int, read: Int, readAt: Long? = null): Long = db.run { c ->
        val id = c.query("INSERT INTO manga (source_id, remote_url, remote_title, user_favorite_at) VALUES (7, ?, 'M', 1) RETURNING id", "/m/${System.nanoTime()}") { it.getLong(1) }.single()
        c.batch("INSERT INTO chapter (manga_id, remote_url, remote_name, remote_chapter_number, remote_order, state_date_fetch, user_read) VALUES (?, ?, ?, ?, ?, 0, ?)",
            (1..chapters).map { i -> listOf(id, "/m/$id/$i", "Ch. $i", i.toDouble(), chapters - i, if (i <= read) 1 else 0) })
        if (readAt != null) c.update("INSERT INTO history (manga_id, chapter_id, read_at) SELECT manga_id, id, ? FROM chapter WHERE manga_id = ? AND remote_chapter_number = 1", readAt, id)
        id
    }

    private suspend fun read(db: Database, mangaId: Long, upTo: Int) = db.run { c ->
        c.update("UPDATE chapter SET user_read = 1 WHERE manga_id = ? AND remote_chapter_number <= ?", mangaId, upTo)
    }

    /** A tracker whose list lives in memory; it counts how many of its calls ever ran at once. */
    private class Fake(prefs: TrackerPrefs) : BaseTracker(99, "Fake", OkHttpClient(), prefs) {
        val remote = ConcurrentHashMap<Long, Track>()
        private val inFlight = AtomicInteger()
        val most = AtomicInteger()
        private suspend fun <T> call(block: () -> T): T {
            most.accumulateAndGet(inFlight.incrementAndGet(), ::maxOf)
            try { delay(20); return block() } finally { inFlight.decrementAndGet() }
        }
        override fun getStatusList() = listOf(1L, 2L, 5L, 6L)
        override fun getStatus(status: Long) = mapOf(1L to "Reading", 2L to "Completed", 5L to "Plan to read", 6L to "Rereading")[status]
        override fun getReadingStatus() = 1L
        override fun getRereadingStatus() = 6L
        override fun getCompletionStatus() = 2L
        override fun getScoreList() = (0..10).map(Int::toString)
        override fun displayScore(track: Track) = track.score.toInt().toString()
        override suspend fun update(track: Track, didReadChapter: Boolean) = call {
            if (didReadChapter) track.status = 1
            remote[track.remote_id] = Track().apply { copyPersonalFrom(track); remote_id = track.remote_id; title = track.title; total_chapters = track.total_chapters }
            track
        }
        override suspend fun bind(track: Track, hasReadChapters: Boolean) = call {
            remote[track.remote_id]?.let { track.copyPersonalFrom(it, false) } ?: run { track.status = if (hasReadChapters) 1 else 5 }
            remote[track.remote_id] = Track().apply { copyPersonalFrom(track); remote_id = track.remote_id }
            track
        }
        override suspend fun search(query: String) = listOf(TrackSearch.create(id).apply { remote_id = 500; title = "Found $query"; total_chapters = 10; tracking_url = "https://fake/500" })
        override suspend fun refresh(track: Track) = call { remote[track.remote_id]?.let { track.copyPersonalFrom(it) }; track }
        override suspend fun login(username: String, password: String) {
            if (password != "right") throw IllegalStateException("refused")
            saveCredentials(username, password)
        }
    }

    @Test
    fun bindUpdateAndUnbindFollowSuwayomisRules() = runBlocking {
        Database(file).use { db ->
            val fake = Fake(TrackerStore(db).of(99))
            val routes = Trackers(db, listOf(fake)).routes
            val m = manga(db, chapters = 10, read = 3, readAt = 1_700_000_000_000L)

            assertEquals(Kind.invalid, routes.fails("track.search", obj("trackerId" to 99, "query" to "x")).kind)
            assertEquals(Kind.invalid, routes.fails("tracker.login", obj("trackerId" to 99, "username" to "u", "password" to "wrong")).kind)
            val listed = routes.getValue("tracker.login")(obj("trackerId" to 99, "username" to "u", "password" to "right")).o()["tracker"]!!.jsonObject
            assertEquals(true, listed["isLoggedIn"]!!.jsonPrimitive.content.toBoolean())

            assertEquals(Kind.notFound, routes.fails("track.bind", obj("mangaId" to m, "trackerId" to 99, "remoteId" to 500)).kind)
            assertEquals("Found x", routes.getValue("track.search")(obj("trackerId" to 99, "query" to "x")).o()["results"]!!.jsonArray[0].jsonObject["title"]!!.jsonPrimitive.content)

            // A new entry: reading, at the highest read chapter, started when chapter 1 was read.
            // The window sends remote ids and dates as strings (Suwayomi's LongString).
            val bound = routes.getValue("track.bind")(obj("mangaId" to m, "trackerId" to 99, "remoteId" to "500")).o().track()
            assertEquals(listOf(1.0, 3.0, 1_700_000_000_000.0, 10.0), listOf(bound.n("status"), bound.n("lastChapterRead"), bound.n("startDate"), bound.n("totalChapters")))
            assertEquals(3.0, fake.remote.getValue(500).last_chapter_read)
            val record = bound["id"]!!.jsonPrimitive.long

            val dated = routes.getValue("track.update")(obj("recordId" to record, "startDate" to "1769817600000", "finishDate" to "0")).o().track()
            assert(dated.n("startDate") == 1_769_817_600_000.0 && dated.n("finishDate") == 0.0) { dated.toString() }
            assertEquals(0.0, routes.getValue("track.update")(obj("recordId" to record, "startDate" to "0")).o().track().n("startDate"))

            // A score from the tracker's list; the last chapter completes it.
            routes.getValue("track.update")(obj("recordId" to record, "scoreString" to "7"))
            assertEquals(Kind.invalid, routes.fails("track.update", obj("recordId" to record, "scoreString" to "eleven")).kind)
            val done = routes.getValue("track.update")(obj("recordId" to record, "lastChapterRead" to 10)).o().track()
            assertEquals(listOf(2.0, 7.0, 10.0), listOf(done.n("status"), done.n("score"), done.n("lastChapterRead")))
            assertTrue(done.n("finishDate") > 0)

            assertEquals(1, routes.getValue("track.list")(obj("mangaIds" to listOf(m))).o()["tracks"]!!.jsonArray.size)
            routes.getValue("track.unbind")(obj("recordId" to record))
            assertEquals(0, routes.getValue("track.list")(obj("mangaIds" to listOf(m))).o()["tracks"]!!.jsonArray.size)
            assertEquals(Kind.notFound, routes.fails("track.unbind", obj("recordId" to record)).kind)
            // Unbind keeps the entry on the tracker, as Miharchy's window says.
            assertTrue(fake.remote.containsKey(500L))

            routes.getValue("tracker.logout")(obj("trackerId" to 99))
            assertEquals(Kind.invalid, routes.fails("track.search", obj("trackerId" to 99, "query" to "x")).kind)
        }
    }

    @Test
    fun aRecordCopiesToAnotherMangaWithNoLoginAndNoTrackerCall() = runBlocking {
        Database(file).use { db ->
            val fake = Fake(TrackerStore(db).of(99))
            val routes = Trackers(db, listOf(fake)).routes
            val old = manga(db, chapters = 5, read = 2)
            val target = manga(db, chapters = 5, read = 0)
            routes.getValue("tracker.login")(obj("trackerId" to 99, "username" to "u", "password" to "right"))
            routes.getValue("track.search")(obj("trackerId" to 99, "query" to "x"))
            val record = routes.getValue("track.bind")(obj("mangaId" to old, "trackerId" to 99, "remoteId" to 500)).o().track()
            routes.getValue("track.update")(obj("recordId" to record["id"]!!.jsonPrimitive.long, "scoreString" to "7"))
            // The target's own record on that tracker goes; Migrate's copy replaces it.
            db.run { c -> c.update("INSERT INTO manga_track (manga_id, tracker_id, remote_id, remote_url, title, last_chapter_read, total_chapters, status, score) VALUES (?, 99, 1, '', 'Own', 0, 0, 1, 0)", target) }
            routes.getValue("tracker.logout")(obj("trackerId" to 99))
            val before = fake.remote.mapValues { it.value.toString() }

            val copied = routes.getValue("track.bind")(obj("mangaId" to target, "recordId" to record["id"]!!.jsonPrimitive.long)).o().track()
            val tracks = routes.getValue("track.list")(obj("mangaIds" to listOf(old, target))).o()["tracks"]!!.jsonArray.map { it.jsonObject }
            val (a, b) = listOf(old, target).map { m -> tracks.single { it["mangaId"]!!.jsonPrimitive.long == m } }
            for (k in listOf("trackerId", "remoteId", "title", "status", "score", "lastChapterRead", "totalChapters", "remoteUrl", "startDate", "finishDate", "private")) assertEquals(a[k], b[k], k)
            assertEquals(target, copied["mangaId"]!!.jsonPrimitive.long)
            assertEquals(before, fake.remote.mapValues { it.value.toString() }, "no tracker call")
            assertEquals(Kind.notFound, routes.fails("track.bind", obj("mangaId" to target, "recordId" to 999)).kind)
        }
    }

    @Test
    fun progressPushesOnlyAHigherChapterAndOneCallRunsAtATime() = runBlocking {
        Database(file).use { db ->
            val fake = Fake(TrackerStore(db).of(99))
            val trackers = Trackers(db, listOf(fake))
            val routes = trackers.routes
            routes.getValue("tracker.login")(obj("trackerId" to 99, "username" to "u", "password" to "right"))
            routes.getValue("track.search")(obj("trackerId" to 99, "query" to "x"))
            val ids = (1..4).map { manga(db, chapters = 10, read = 2) }
            ids.forEach { routes.getValue("track.bind")(obj("mangaId" to it, "trackerId" to 99, "remoteId" to 500)) }
            // The tracker's own entry is ahead: a refresh reads it, and nothing goes back.
            fake.remote.getValue(500).last_chapter_read = 6.0
            read(db, ids[0], 4)
            val behind = routes.getValue("track.progress")(obj("mangaIds" to listOf(ids[0]))).o()["tracks"]!!.jsonArray[0].jsonObject
            assertEquals(6.0, behind.n("lastChapterRead"))

            ids.forEach { read(db, it, 8) }
            fake.most.set(0)
            val replies = ids.map { id -> async { routes.getValue("track.progress")(obj("mangaIds" to listOf(id))).o() } }.awaitAll()
            assertEquals(listOf(8.0, 8.0, 8.0, 8.0), replies.map { it["tracks"]!!.jsonArray[0].jsonObject.n("lastChapterRead") })
            assertEquals(1, fake.most.get())

            val library = Library(db, Extensions(db, TestHost.host, work.resolve("extensions"))).routes.getValue("library.list")(JsonObject(emptyMap())).toString()
            assertTrue("\"trackCount\":1" in library, library)
        }
    }

    /** AniList through a local site: the token login, a bind and an update, and no token in any reply. */
    @Test
    fun aniListLogsInBindsAndNeverShowsItsToken() = runBlocking {
        val token = "tok-${System.nanoTime()}"
        val entries = ConcurrentHashMap<Int, JsonObject>()
        val seen = mutableListOf<String>()
        Site { ex ->
            val body = Json.parseToJsonElement(ex.requestBody.readBytes().decodeToString()).jsonObject
            val query = body["query"]!!.jsonPrimitive.content
            val vars = body["variables"]!!.jsonObject
            synchronized(seen) { seen += query.substringAfter(' ').substringBefore('(').substringBefore(' ').trim() }
            if (ex.requestHeaders.getFirst("Authorization") != "Bearer $token") {
                return@Site """{"errors":[{"message":"Invalid token"}]}""".toByteArray()
            }
            val media = """{"id":30013,"title":{"userPreferred":"One Piece"},"chapters":0,"format":"MANGA","countryOfOrigin":"JP","status":"RELEASING","staff":{"edges":[]}}"""
            when {
                "Viewer" in query -> """{"data":{"Viewer":{"id":42,"name":"reader","mediaListOptions":{"scoreFormat":"POINT_10"}}}}"""
                "AniListSearchManga" in query -> """{"data":{"Page":{"media":[$media]}}}"""
                "AniListGetLibManga" in query -> {
                    val e = entries[vars["manga_id"]!!.jsonPrimitive.int]
                    """{"data":{"Page":{"mediaList":[${e?.let { "${it.toString().dropLast(1)},\"media\":$media}" } ?: ""}]}}}"""
                }
                "SaveMediaListEntry" in query -> {
                    val id = vars["manga_id"]?.jsonPrimitive?.int ?: entries.entries.first { it.value["id"]!!.jsonPrimitive.int == vars["library_id"]!!.jsonPrimitive.int }.key
                    entries[id] = buildJsonObject {
                        put("id", 777); put("status", vars["status"]!!); put("progress", vars["progress"]!!)
                        put("scoreRaw", vars["score"]?.jsonPrimitive?.int ?: 0); put("private", vars["private"]!!)
                    }
                    """{"data":{"SaveMediaListEntry":{"id":777}}}"""
                }
                else -> null
            }?.toByteArray()
        }.use { site ->
            val local = site.url.toHttpUrl()
            val http = OkHttpClient.Builder().addInterceptor { chain ->
                chain.proceed(chain.request().newBuilder().url(chain.request().url.newBuilder().scheme("http").host(local.host).port(local.port).build()).build())
            }.build()
            Database(file).use { db ->
                val routes = Trackers(db, listOf(Anilist(http, TrackerStore(db).of(2)))).routes
                val replies = mutableListOf<String>()
                suspend fun call(name: String, input: JsonObject) = routes.getValue(name)(input).also { replies += it.toString() }
                suspend fun refused(name: String, input: JsonObject) = routes.fails(name, input).also { replies += "${it.kind} ${it.message}" }

                // A login that cannot reach AniList is a network failure, not a refusal.
                val dead = OkHttpClient.Builder().addInterceptor { throw java.io.IOException("offline") }.build()
                val offline = Trackers(db, listOf(Anilist(dead, TrackerStore(db).of(2)))).routes
                assertEquals(Kind.network, offline.fails("tracker.login", obj("trackerId" to 2, "callbackUrl" to "https://suwayomi.org/tracker-oauth#access_token=$token")).kind)

                val authUrl = call("tracker.list", JsonObject(emptyMap())).o()["trackers"]!!.jsonArray[0].jsonObject["authUrl"]!!.jsonPrimitive.content
                assertTrue(authUrl.startsWith("https://anilist.co/api/v2/oauth/authorize?client_id=16186"), authUrl)
                assertEquals(Kind.invalid, refused("tracker.login", obj("trackerId" to 2, "callbackUrl" to "https://suwayomi.org/tracker-oauth#access_token=wrong-$token")).kind)
                call("tracker.login", obj("trackerId" to 2, "callbackUrl" to "https://suwayomi.org/tracker-oauth#access_token=$token&token_type=Bearer&expires_in=31536000"))
                // A restart: a new store and tracker read the login back from core.db and call AniList with it.
                val restarted = Trackers(db, listOf(Anilist(http, TrackerStore(db).of(2)))).routes
                assertEquals(1, restarted.getValue("track.search")(obj("trackerId" to 2, "query" to "one piece")).o()["results"]!!.jsonArray.size)
                val m = manga(db, chapters = 12, read = 5)
                assertEquals(30013L, call("track.search", obj("trackerId" to 2, "query" to "one piece")).o()["results"]!!.jsonArray[0].jsonObject["remoteId"]!!.jsonPrimitive.long)
                val bound = call("track.bind", obj("mangaId" to m, "trackerId" to 2, "remoteId" to 30013)).o().track()
                assertEquals(listOf(1.0, 5.0), listOf(bound.n("status"), bound.n("lastChapterRead")))
                assertEquals("CURRENT", entries.getValue(30013)["status"]!!.jsonPrimitive.content)
                val scored = call("track.update", obj("recordId" to bound["id"]!!.jsonPrimitive.long, "scoreString" to "8", "status" to 3)).o().track()
                assertEquals("8", scored["displayScore"]!!.jsonPrimitive.content)
                assertEquals(listOf("PAUSED", "80"), entries.getValue(30013).let { listOf(it["status"]!!.jsonPrimitive.content, it["scoreRaw"]!!.jsonPrimitive.content) })
                call("track.progress", obj("mangaIds" to listOf(m)))
                call("track.list", obj("mangaIds" to listOf(m)))
                call("tracker.list", JsonObject(emptyMap()))
                call("tracker.logout", obj("trackerId" to 2))
                assertEquals(Kind.invalid, refused("track.search", obj("trackerId" to 2, "query" to "x")).kind)

                assertTrue("AniListUpdateManga" in seen && "AniListAddManga" in seen, seen.toString())
                // Criterion 2: no reply or error carries the token or the callback.
                replies.forEach { assertFalse(token in it || "access_token" in it, it) }
                // A logout leaves no token behind.
                assertEquals(0, db.run { c -> c.query("SELECT count(*) FROM tracker_pref WHERE value LIKE ?", "%$token%") { it.getInt(1) }.single() })
            }
        }
    }
}
