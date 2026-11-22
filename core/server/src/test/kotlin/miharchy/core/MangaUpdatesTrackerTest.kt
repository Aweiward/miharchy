package miharchy.core

import eu.kanade.tachiyomi.data.track.mangaupdates.MangaUpdates
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
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
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import java.nio.file.Files
import java.util.concurrent.ConcurrentHashMap
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** MangaUpdates through a local site: the password login, search, bind, update and progress, and no secret in any reply. */
class MangaUpdatesTrackerTest {
    private val work = Files.createTempDirectory("mangaupdates")

    private fun obj(vararg pairs: Pair<String, Any>) = buildJsonObject {
        for ((k, v) in pairs) put(k, when (v) {
            is JsonElement -> v
            is Boolean -> JsonPrimitive(v)
            is Number -> JsonPrimitive(v)
            is List<*> -> JsonArray(v.map { JsonPrimitive(it as Number) })
            else -> JsonPrimitive(v.toString())
        })
    }

    private fun JsonObject.track() = this["track"]!!.jsonObject
    private fun JsonObject.n(k: String) = this[k]!!.jsonPrimitive.double

    private suspend fun Map<String, Route>.fails(name: String, input: JsonObject): ApiError =
        try { getValue(name)(input); kotlin.test.fail("$name should fail") } catch (e: ApiError) { e }

    /** Every host goes to the local [site]. */
    private fun local(site: Site): OkHttpClient {
        val local = site.url.toHttpUrl()
        return OkHttpClient.Builder().addInterceptor { chain ->
            chain.proceed(chain.request().newBuilder().url(chain.request().url.newBuilder().scheme("http").host(local.host).port(local.port).build()).build())
        }.build()
    }

    private suspend fun manga(db: Database, chapters: Int, read: Int): Long = db.run { c ->
        val id = c.query("INSERT INTO manga (source_id, remote_url, remote_title, user_favorite_at) VALUES (7, ?, 'M', 1) RETURNING id", "/m/${System.nanoTime()}") { it.getLong(1) }.single()
        c.batch("INSERT INTO chapter (manga_id, remote_url, remote_name, remote_chapter_number, remote_order, state_date_fetch, user_read) VALUES (?, ?, ?, ?, ?, 0, ?)",
            (1..chapters).map { i -> listOf(id, "/m/$id/$i", "Ch. $i", i.toDouble(), chapters - i, if (i <= read) 1 else 0) })
        id
    }

    private suspend fun rows(db: Database, secret: String) =
        db.run { c -> c.query("SELECT count(*) FROM tracker_pref WHERE value LIKE ?", "%$secret%") { it.getInt(1) }.single() }

    private fun record(id: Int) = """{"series_id":$id,"title":"One &amp; Piece","url":"https://www.mangaupdates.com/series/$id","description":"A <b>pirate</b>.","image":{"url":{"original":"http://x/c.jpg"}},"type":"Manga","year":"1997","bayesian_rating":9.1,"authors":[{"name":"Oda","type":"Author"},{"name":"Oda","type":"Artist"}]}"""

    @Test
    fun mangaUpdatesLogsInBindsAndNeverShowsItsSecrets() = runBlocking {
        val session = "session-${System.nanoTime()}"
        val password = "hunter2-${System.nanoTime()}"
        // series id -> list_id, chapter, rating
        val list = ConcurrentHashMap<Long, JsonObject>()
        val ratings = ConcurrentHashMap<Long, Double>()
        list[300] = obj("list_id" to 4, "chapter" to 17)
        ratings[300] = 6.5
        val seen = mutableListOf<String>()
        Site { ex ->
            val path = ex.requestURI.path
            val body = ex.requestBody.readBytes().decodeToString()
            synchronized(seen) { seen += "${ex.requestMethod} $path" }
            val authed = ex.requestHeaders.getFirst("Authorization") == "Bearer $session"
            val id = Regex("/v1/(?:lists/)?series/(\\d+)").find(path)?.groupValues?.get(1)?.toLong()
            when {
                path == "/v1/account/login" -> {
                    val b = Json.parseToJsonElement(body).jsonObject
                    if (b["username"]!!.jsonPrimitive.content == "reader" && b["password"]!!.jsonPrimitive.content == password) """{"status":"success","context":{"session_token":"$session","uid":42}}""" else null
                }
                path == "/v1/account/profile" && authed -> """{"username":"reader"}"""
                path == "/v1/series/search" -> """{"total_hits":1,"results":[{"record":${record(300)}}]}"""
                id != null && path == "/v1/series/$id" && ex.requestMethod == "GET" -> record(id.toInt())
                !authed -> null
                path == "/v1/lists/series/$id" && ex.requestMethod == "GET" ->
                    list[id]?.let { """{"series":{"id":$id,"title":"T"},"list_id":${it["list_id"]},"status":{"chapter":${it["chapter"]}}}""" }
                path == "/v1/series/$id/rating" && ex.requestMethod == "GET" -> ratings[id]?.let { """{"rating":$it}""" }
                path == "/v1/series/$id/rating" && ex.requestMethod == "PUT" -> { ratings[id!!] = Json.parseToJsonElement(body).jsonObject["rating"]!!.jsonPrimitive.double; "" }
                path == "/v1/series/$id/rating" && ex.requestMethod == "DELETE" -> { ratings.remove(id); "" }
                path == "/v1/lists/series" -> {
                    val e = Json.parseToJsonElement(body).jsonArray[0].jsonObject
                    list[e["series"]!!.jsonObject["id"]!!.jsonPrimitive.long] = obj("list_id" to e["list_id"]!!.jsonPrimitive.int, "chapter" to 0)
                    ""
                }
                path == "/v1/lists/series/update" -> {
                    val e = Json.parseToJsonElement(body).jsonArray[0].jsonObject
                    list[e["series"]!!.jsonObject["id"]!!.jsonPrimitive.long] = obj("list_id" to e["list_id"]!!.jsonPrimitive.int, "chapter" to e["status"]!!.jsonObject["chapter"]!!.jsonPrimitive.int)
                    ""
                }
                else -> null
            }?.toByteArray()
        }.use { site ->
            Database(work.resolve("core.db")).use { db ->
                val routes = Trackers(db, listOf(MangaUpdates(local(site), TrackerStore(db).of(7)))).routes
                val replies = mutableListOf<String>()
                suspend fun call(name: String, input: JsonObject) = routes.getValue(name)(input).jsonObject.also { replies += it.toString() }
                suspend fun refused(name: String, input: JsonObject) = routes.fails(name, input).also { replies += "${it.kind} ${it.message}" }

                val listed = call("tracker.list", JsonObject(emptyMap()))["trackers"]!!.jsonArray[0].jsonObject
                assertEquals(JsonNull, listed["authUrl"])
                assertEquals("MangaUpdates", listed["name"]!!.jsonPrimitive.content)

                assertEquals(Kind.invalid, refused("tracker.login", obj("trackerId" to 7, "username" to "reader", "password" to "wrong-$password")).kind)
                assertEquals(0, db.run { c -> c.query("SELECT count(*) FROM tracker_pref WHERE key IN ('username', 'password') AND value <> ''") { it.getInt(1) }.single() })
                assertEquals(Kind.invalid, refused("track.search", obj("trackerId" to 7, "query" to "x")).kind)

                assertTrue(call("tracker.login", obj("trackerId" to 7, "username" to "reader", "password" to password))["tracker"]!!.jsonObject["isLoggedIn"]!!.jsonPrimitive.content.toBoolean())
                // The user id and the session are kept as Mihon does; the user's password is not.
                assertEquals("42", db.run { c -> c.query("SELECT value FROM tracker_pref WHERE tracker_id = 7 AND key = 'username'") { it.getString(1) }.single() })
                assertEquals(1, rows(db, session))
                assertEquals(0, rows(db, password))

                val m = manga(db, chapters = 12, read = 5)
                val found = call("track.search", obj("trackerId" to 7, "query" to "one piece"))["results"]!!.jsonArray[0].jsonObject
                assertEquals(listOf(300L, "One & Piece", "A pirate."), listOf(found["remoteId"]!!.jsonPrimitive.long, found["title"]!!.jsonPrimitive.content, found["summary"]!!.jsonPrimitive.content))

                // An entry already on the list is read, not overwritten: its list, chapter and rating come in.
                val existing = call("track.bind", obj("mangaId" to manga(db, chapters = 30, read = 0), "trackerId" to 7, "remoteId" to 300)).track()
                assertEquals(listOf(4.0, 17.0, 6.5), listOf("status", "lastChapterRead", "score").map { existing.n(it) })

                // A new entry: added as Reading, then the read chapters go up.
                routes.getValue("track.search")(obj("trackerId" to 7, "query" to "one piece"))
                list.remove(300)
                val bound = call("track.bind", obj("mangaId" to m, "trackerId" to 7, "remoteId" to 300)).track()
                assertEquals(listOf(0.0, 5.0), listOf(bound.n("status"), bound.n("lastChapterRead")))
                assertEquals(listOf(0, 5), list.getValue(300).let { listOf(it["list_id"]!!.jsonPrimitive.int, it["chapter"]!!.jsonPrimitive.int) })

                val scored = call("track.update", obj("recordId" to bound["id"]!!.jsonPrimitive.long, "scoreString" to "8.5", "status" to 2)).track()
                assertEquals("8.5", scored["displayScore"]!!.jsonPrimitive.content)
                assertEquals(listOf(2, 8.5), listOf(list.getValue(300)["list_id"]!!.jsonPrimitive.int, ratings[300]))
                call("track.update", obj("recordId" to bound["id"]!!.jsonPrimitive.long, "scoreString" to "-"))
                assertEquals(null, ratings[300])

                db.run { c -> c.update("UPDATE chapter SET user_read = 1 WHERE manga_id = ? AND remote_chapter_number <= 9", m) }
                call("track.update", obj("recordId" to bound["id"]!!.jsonPrimitive.long, "status" to 0))
                val progressed = call("track.progress", obj("mangaIds" to listOf(m)))["tracks"]!!.jsonArray[0].jsonObject
                assertEquals(9.0, progressed.n("lastChapterRead"))
                assertEquals(9, list.getValue(300)["chapter"]!!.jsonPrimitive.int)

                call("track.list", obj("mangaIds" to listOf(m)))
                call("tracker.logout", obj("trackerId" to 7))
                assertEquals(Kind.invalid, refused("track.search", obj("trackerId" to 7, "query" to "x")).kind)
                assertTrue("PUT /v1/account/login" in seen && "POST /v1/lists/series" in seen && "POST /v1/lists/series/update" in seen && "PUT /v1/series/300/rating" in seen, seen.toString())

                // Criterion 2: no reply or error carries the session or the password.
                replies.forEach { r -> listOf(session, password).forEach { assertFalse(it in r, r) } }
                assertEquals(0, rows(db, session))
                assertEquals(0, rows(db, password))
                assertEquals(0, db.run { c -> c.query("SELECT count(*) FROM tracker_pref WHERE key IN ('username', 'password') AND value <> ''") { it.getInt(1) }.single() })
            }
        }
    }

    @Test
    fun aLoginReplyInTheWrongShapeLeaksNothing() = runBlocking {
        val leak = "leak-${System.nanoTime()}"
        var shape = 0
        Site { ex ->
            ex.requestBody.readBytes()
            if (ex.requestURI.path != "/v1/account/login") return@Site null
            when (shape++ % 3) {
                0 -> """{"context":{"session_token":{"v":"$leak"},"uid":"$leak"}}"""
                1 -> """{"context":"$leak"}"""
                else -> """{"context":{"session_token":"$leak"}}"""
            }.toByteArray()
        }.use { site ->
            Database(work.resolve("shape.db")).use { db ->
                val routes = Trackers(db, listOf(MangaUpdates(local(site), TrackerStore(db).of(7)))).routes
                repeat(3) {
                    val e = routes.fails("tracker.login", obj("trackerId" to 7, "username" to "reader", "password" to "pw$it"))
                    assertEquals(Kind.invalid, e.kind)
                    assertFalse(leak in e.message.orEmpty(), e.message)
                }
                assertEquals(0, rows(db, leak))
                assertFalse(routes.getValue("tracker.list")(JsonObject(emptyMap())).toString().contains(leak))
            }
        }
    }
}
