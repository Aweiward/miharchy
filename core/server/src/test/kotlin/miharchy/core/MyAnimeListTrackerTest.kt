package miharchy.core

import eu.kanade.tachiyomi.data.track.myanimelist.MALOAuth
import eu.kanade.tachiyomi.data.track.myanimelist.MyAnimeList
import eu.kanade.tachiyomi.network.trackJson
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import java.net.URLDecoder
import java.nio.file.Files
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** MyAnimeList through a local site that stands in for myanimelist.net and api.myanimelist.net. */
class MyAnimeListTrackerTest {
    private val work = Files.createTempDirectory("mal")
    private val file = work.resolve("core.db")
    private val clientId = "3fda277931a4f9bc01fa4a715ce8b91d"

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

    private suspend fun manga(db: Database, chapters: Int, read: Int): Long = db.run { c ->
        val id = c.query("INSERT INTO manga (source_id, remote_url, remote_title, user_favorite_at) VALUES (7, ?, 'M', 1) RETURNING id", "/m/${System.nanoTime()}") { it.getLong(1) }.single()
        c.batch("INSERT INTO chapter (manga_id, remote_url, remote_name, remote_chapter_number, remote_order, state_date_fetch, user_read) VALUES (?, ?, ?, ?, ?, 0, ?)",
            (1..chapters).map { i -> listOf(id, "/m/$id/$i", "Ch. $i", i.toDouble(), chapters - i, if (i <= read) 1 else 0) })
        id
    }

    private class Seen(val method: String, val path: String, val query: String, val form: Map<String, String>, val auth: String?) {
        val url get() = "http://x$path?$query".toHttpUrl()
    }

    /** The two MAL hosts in one: a token endpoint and a v2 API with a list of entries. */
    private class FakeMal {
        val code = "code-${System.nanoTime()}"
        @Volatile var challenge = ""
        @Volatile var badShape = false
        val access = AtomicReference("access-0-${System.nanoTime()}")
        val refresh = AtomicReference("refresh-0-${System.nanoTime()}")
        private val issued = AtomicInteger()
        val refreshes = AtomicInteger()
        val seen = CopyOnWriteArrayList<Seen>()
        val entries = ConcurrentHashMap<Long, Map<String, String>>()

        private fun node(id: Int, total: Int, type: String = "manga") =
            """{"id":$id,"title":"Berserk $id","synopsis":"s","num_chapters":$total,"mean":9.4,"main_picture":{"large":"http://c/$id.jpg"},"status":"currently_publishing","media_type":"$type","start_date":"1989-08","authors":[{"node":{"id":1,"first_name":"Kentaro","last_name":"Miura"},"role":"Story & Art"}]}"""

        private fun status(e: Map<String, String>) = buildString {
            append("""{"status":"${e["status"]}","is_rereading":${e["is_rereading"]},"num_chapters_read":${e["num_chapters_read"]},"score":${e["score"]!!.toDouble().toInt()}""")
            e["start_date"]?.takeIf { it.isNotBlank() }?.let { append(""","start_date":"$it"""") }
            e["finish_date"]?.takeIf { it.isNotBlank() }?.let { append(""","finish_date":"$it"""") }
            append("}")
        }

        private fun issue(): ByteArray {
            val n = issued.incrementAndGet()
            access.set("access-$n-${System.nanoTime()}")
            refresh.set("refresh-$n-${System.nanoTime()}")
            return """{"token_type":"Bearer","expires_in":2678400,"access_token":"${access.get()}","refresh_token":"${refresh.get()}"}""".toByteArray()
        }

        fun handle(ex: com.sun.net.httpserver.HttpExchange): ByteArray? {
            val path = ex.requestURI.path
            val auth = ex.requestHeaders.getFirst("Authorization")
            val form = ex.requestBody.readBytes().decodeToString().split('&').filter { it.isNotEmpty() }
                .associate { it.substringBefore('=').let({ URLDecoder.decode(it, "UTF-8") }) to URLDecoder.decode(it.substringAfter('='), "UTF-8") }
            seen += Seen(ex.requestMethod, path, ex.requestURI.rawQuery.orEmpty(), form, auth)
            if (path == "/v1/oauth2/token") {
                if (form["client_id"] != "3fda277931a4f9bc01fa4a715ce8b91d") return null
                return when (form["grant_type"]) {
                    "authorization_code" -> if (form["code"] == code && form["code_verifier"] == challenge) { if (badShape) """{"access_token":{"v":"${access.get()}"},"refresh_token":"${refresh.get()}"}""".toByteArray() else issue() } else null
                    "refresh_token" -> if (form["refresh_token"] == refresh.get()) {
                        refreshes.incrementAndGet()
                        if (badShape) """{"access_token":{"v":"${access.get()}"},"refresh_token":"${refresh.get()}"}""".toByteArray() else issue()
                    } else null
                    else -> null
                }
            }
            if (auth != "Bearer ${access.get()}") return null
            val q = ex.requestURI.query.orEmpty()
            val id = Regex("^/v2/manga/(\\d+)").find(path)?.groupValues?.get(1)?.toLong()
            return when {
                path == "/v2/users/@me" -> """{"id":1,"name":"reader"}"""
                path == "/v2/users/@me/mangalist" -> """{"data":[{"node":${node(7, 20)}}],"paging":{}}"""
                path == "/v2/manga" -> """{"data":[{"node":${node(2, 10)}},{"node":${node(3, 0, "light_novel")}},{"node":${node(7, 20)}}],"paging":{"next":"x"}}"""
                id != null && path.endsWith("/my_list_status") && ex.requestMethod == "PUT" -> {
                    entries[id] = form
                    status(form)
                }
                id != null && path.endsWith("/my_list_status") && ex.requestMethod == "DELETE" -> { entries.remove(id); "" }
                id != null && "synopsis" in q -> node(id.toInt(), 10)
                id != null -> """{"id":$id,"num_chapters":${if (id == 7L) 20 else 10}${entries[id]?.let { ""","my_list_status":${status(it)}""" } ?: ""}}"""
                else -> null
            }?.toByteArray()
        }
    }

    private fun clientTo(site: Site): OkHttpClient {
        val local = site.url.toHttpUrl()
        return OkHttpClient.Builder().addInterceptor { chain ->
            chain.proceed(chain.request().newBuilder().url(chain.request().url.newBuilder().scheme("http").host(local.host).port(local.port).build()).build())
        }.build()
    }

    private suspend fun authUrl(routes: Map<String, Route>) =
        routes.call("tracker.list")["trackers"]!!.jsonArray[0].jsonObject["authUrl"]!!.jsonPrimitive.content

    private fun callback(code: String) = "https://suwayomi.org/tracker-oauth?code=$code&state=s"

    @Test
    fun malLogsInBindsAndNeverShowsItsToken() = runBlocking {
        val mal = FakeMal()
        Site { mal.handle(it) }.use { site ->
            val http = clientTo(site)
            Database(file).use { db ->
                val routes = Trackers(db, listOf(MyAnimeList(http, TrackerStore(db).of(1)))).routes
                val replies = mutableListOf<String>()
                suspend fun call(name: String, input: JsonObject) = routes.getValue(name)(input).also { replies += it.toString() }
                suspend fun refused(name: String, input: JsonObject) = routes.fails(name, input).also { replies += "${it.kind} ${it.message}" }

                // A login that cannot reach MAL is a network failure, not a refusal.
                val dead = OkHttpClient.Builder().addInterceptor { throw java.io.IOException("offline") }.build()
                val offline = Trackers(db, listOf(MyAnimeList(dead, TrackerStore(db).of(1)))).routes
                authUrl(offline)
                assertEquals(Kind.network, offline.fails("tracker.login", obj("trackerId" to 1, "callbackUrl" to callback(mal.code))).kind)

                // PKCE: two lists give one address, with Suwayomi's client, "plain" and no redirect_uri.
                val first = authUrl(routes)
                assertEquals(first, authUrl(routes))
                val url = first.toHttpUrl()
                assertEquals("https://myanimelist.net/v1/oauth2/authorize", first.substringBefore('?'))
                assertEquals(listOf(clientId, "code"), listOf(url.queryParameter("client_id"), url.queryParameter("response_type")))
                assertEquals(null, url.queryParameter("redirect_uri"))
                assertEquals(null, url.queryParameter("code_challenge_method"))

                // A refused login ends it: the next address has a new verifier.
                mal.challenge = url.queryParameter("code_challenge")!!
                assertEquals(Kind.invalid, refused("tracker.login", obj("trackerId" to 1, "callbackUrl" to callback("wrong-${mal.code}"))).kind)
                val second = authUrl(routes)
                assertNotEquals(first, second)
                assertEquals(second, authUrl(routes))
                mal.challenge = second.toHttpUrl().queryParameter("code_challenge")!!

                call("tracker.login", obj("trackerId" to 1, "callbackUrl" to callback(mal.code)))
                val tokenCall = mal.seen.last { it.path == "/v1/oauth2/token" }
                assertEquals(mapOf("client_id" to clientId, "code" to mal.code, "code_verifier" to mal.challenge, "grant_type" to "authorization_code"), tokenCall.form)
                assertEquals(true, call("tracker.list", JsonObject(emptyMap())).o()["trackers"]!!.jsonArray[0].jsonObject["isLoggedIn"]!!.jsonPrimitive.content.toBoolean())

                // The login stored the user and the OAuth object, and the display name.
                val store = TrackerStore(db).of(1)
                assertEquals(listOf("reader", mal.access.get(), "reader"), listOf(store["username"], store["password"], store["displayUsername"]))
                val oauth = Json.parseToJsonElement(store["token"]!!).jsonObject
                assertEquals(listOf(mal.access.get(), mal.refresh.get()), listOf("access_token", "refresh_token").map { oauth[it]!!.jsonPrimitive.content })

                // A restart: a new store and tracker read the login back from core.db and call MAL with it.
                val restarted = Trackers(db, listOf(MyAnimeList(http, TrackerStore(db).of(1)))).routes
                assertEquals(2L, restarted.getValue("track.search")(obj("trackerId" to 1, "query" to "id:2")).o()["results"]!!.jsonArray.single().jsonObject["remoteId"]!!.jsonPrimitive.long)

                val search = call("track.search", obj("trackerId" to 1, "query" to "berserk")).o()["results"]!!.jsonArray
                // The light novel is left out.
                assertEquals(listOf(2L, 7L), search.map { it.jsonObject["remoteId"]!!.jsonPrimitive.long })
                val searched = mal.seen.last { it.path == "/v2/manga" }.url
                assertEquals(listOf("berserk", "true"), listOf(searched.queryParameter("q"), searched.queryParameter("nsfw")))
                assertTrue(searched.queryParameter("fields")!!.startsWith("id,title,synopsis,num_chapters,mean,main_picture"), searched.toString())
                assertEquals("Bearer ${mal.access.get()}", mal.seen.last { it.path == "/v2/manga" }.auth)
                assertEquals(listOf("Berserk 2", 10L), search[0].jsonObject.let { listOf(it["title"]!!.jsonPrimitive.content, it["totalChapters"]!!.jsonPrimitive.long) })
                assertEquals(2L, call("track.search", obj("trackerId" to 1, "query" to "id:2")).o()["results"]!!.jsonArray.single().jsonObject["remoteId"]!!.jsonPrimitive.long)

                // A new entry: bound as reading, then moved to the chapter read.
                val m = manga(db, chapters = 12, read = 5)
                val bound = call("track.bind", obj("mangaId" to m, "trackerId" to 1, "remoteId" to 2)).o().track()
                assertEquals(listOf(1.0, 5.0), listOf(bound.n("status"), bound.n("lastChapterRead")))
                val put = mal.seen.first { it.method == "PUT" }
                assertEquals("/v2/manga/2/my_list_status", put.path)
                assertEquals(mapOf("status" to "reading", "is_rereading" to "false", "score" to "0.0", "num_chapters_read" to "0", "start_date" to "", "finish_date" to ""), put.form)
                assertEquals(listOf("reading", "5"), mal.entries.getValue(2L).let { listOf(it["status"], it["num_chapters_read"]) })

                // An entry already on the user's list: its status, score, chapters and dates come back.
                val m2 = manga(db, chapters = 12, read = 3)
                mal.entries[7L] = mapOf("status" to "completed", "is_rereading" to "false", "score" to "9", "num_chapters_read" to "20", "start_date" to "2020-01-02", "finish_date" to "2020-03-04")
                val existing = call("track.bind", obj("mangaId" to m2, "trackerId" to 1, "remoteId" to 7)).o().track()
                assertEquals(listOf(2.0, 9.0, 20.0), listOf(existing.n("status"), existing.n("score"), existing.n("lastChapterRead")))
                assertTrue(existing.n("startDate") > 0 && existing.n("finishDate") > existing.n("startDate"))
                assertEquals(listOf("2020-01-02", "2020-03-04"), mal.entries.getValue(7L).let { listOf(it["start_date"], it["finish_date"]) })

                // An update with a status and a score.
                val scored = call("track.update", obj("recordId" to bound["id"]!!.jsonPrimitive.long, "scoreString" to "8", "status" to 3)).o().track()
                assertEquals("8", scored["displayScore"]!!.jsonPrimitive.content)
                assertEquals(listOf("on_hold", "8.0", "5"), mal.entries.getValue(2L).let { listOf(it["status"], it["score"], it["num_chapters_read"]) })

                // Progress: the manga's 10 chapters read finish the entry.
                db.run { c -> c.update("UPDATE chapter SET user_read = 1 WHERE manga_id = ? AND remote_chapter_number <= ?", m, 10) }
                val progress = call("track.progress", obj("mangaIds" to listOf(m))).o()
                assertEquals(0, progress["failed"]!!.jsonArray.size)
                mal.entries.getValue(2L).let {
                    assertEquals(listOf("completed", "10"), listOf(it["status"], it["num_chapters_read"]))
                    assertTrue(it["finish_date"]!!.isNotBlank(), it.toString())
                }
                call("track.list", obj("mangaIds" to listOf(m)))

                // The list is searched by the my: prefix.
                assertEquals(listOf(7L), call("track.search", obj("trackerId" to 1, "query" to "my:berserk 7")).o()["results"]!!.jsonArray.map { it.jsonObject["remoteId"]!!.jsonPrimitive.long })

                call("tracker.logout", obj("trackerId" to 1))
                assertNotEquals(second, authUrl(routes))
                assertEquals(Kind.invalid, refused("track.search", obj("trackerId" to 1, "query" to "x")).kind)

                // Criterion 2: no reply or error carries a token, the code or the verifier.
                val secrets = listOf(mal.code, mal.access.get(), mal.refresh.get(), mal.challenge)
                replies.forEach { r -> secrets.forEach { assertFalse(it in r, r) } }
                // A logout leaves no token behind.
                secrets.forEach { s -> assertEquals(0, db.run { c -> c.query("SELECT count(*) FROM tracker_pref WHERE value LIKE ?", "%$s%") { it.getInt(1) }.single() }) }
                assertEquals(0, db.run { c -> c.query("SELECT count(*) FROM tracker_pref WHERE tracker_id = 1 AND key IN ('token', 'password') AND value != ''") { it.getInt(1) }.single() })
            }
        }
    }

    @Test
    fun malRefreshesAnExpiredTokenOnceAndKeepsTheNewOne() = runBlocking {
        val mal = FakeMal()
        Site { mal.handle(it) }.use { site ->
            val http = clientTo(site)
            Database(file).use { db ->
                val prefs = TrackerStore(db).of(1)
                val first = Trackers(db, listOf(MyAnimeList(http, prefs))).routes
                mal.challenge = authUrl(first).toHttpUrl().queryParameter("code_challenge")!!
                first.call("tracker.login", obj("trackerId" to 1, "callbackUrl" to callback(mal.code)))
                assertEquals(0, mal.refreshes.get())
                val oldAccess = mal.access.get()
                val oldRefresh = mal.refresh.get()

                // The saved token is old; a tracker that starts now reads it and must refresh it.
                prefs["token"] = trackJson.encodeToString(MALOAuth.serializer(), MALOAuth(oldRefresh, oldAccess, 3600, createdAt = 1000))
                val routes = Trackers(db, listOf(MyAnimeList(http, prefs))).routes
                routes.call("track.search", obj("trackerId" to 1, "query" to "berserk"))
                routes.call("track.search", obj("trackerId" to 1, "query" to "berserk"))
                assertEquals(1, mal.refreshes.get())

                val refresh = mal.seen.single { it.form["grant_type"] == "refresh_token" }
                assertEquals(mapOf("client_id" to clientId, "refresh_token" to oldRefresh, "grant_type" to "refresh_token"), refresh.form)
                assertEquals("Bearer $oldAccess", refresh.auth)
                assertEquals("/v1/oauth2/token", refresh.path)
                val searches = mal.seen.filter { it.path == "/v2/manga" }
                assertEquals(listOf("Bearer ${mal.access.get()}", "Bearer ${mal.access.get()}"), searches.map { it.auth })
                assertNotEquals(oldAccess, mal.access.get())

                // The new token is saved; the old one is gone.
                val saved = Json.parseToJsonElement(prefs["token"]!!).jsonObject
                assertEquals(listOf(mal.access.get(), mal.refresh.get()), listOf("access_token", "refresh_token").map { saved[it]!!.jsonPrimitive.content })
                assertFalse(oldAccess in prefs["token"]!! || oldRefresh in prefs["token"]!!)

                // A refresh answered in the wrong shape fails the call and the error holds no token.
                val stale = prefs["token"]!!
                prefs["token"] = trackJson.encodeToString(MALOAuth.serializer(), MALOAuth(mal.refresh.get(), mal.access.get(), 3600, createdAt = 1000))
                mal.badShape = true
                val broken = Trackers(db, listOf(MyAnimeList(http, prefs))).routes
                val error = broken.fails("track.search", obj("trackerId" to 1, "query" to "berserk"))
                assertEquals(Kind.network, error.kind)
                assertTrue("refresh" in error.message!!, error.message)
                listOf(mal.access.get(), mal.refresh.get(), stale).forEach { assertFalse(it in error.message!!, error.message) }

                // Logout leaves no token.
                routes.call("tracker.logout", obj("trackerId" to 1))
                assertEquals(0, db.run { c -> c.query("SELECT count(*) FROM tracker_pref WHERE value LIKE '%access-%' OR value LIKE '%refresh-%'") { it.getInt(1) }.single() })
            }
        }
    }

    @Test
    fun malTokenAnsweredInTheWrongShapeLeaksNothing() = runBlocking {
        val mal = FakeMal().apply { badShape = true }
        Site { mal.handle(it) }.use { site ->
            Database(file).use { db ->
                val routes = Trackers(db, listOf(MyAnimeList(clientTo(site), TrackerStore(db).of(1)))).routes
                mal.challenge = authUrl(routes).toHttpUrl().queryParameter("code_challenge")!!
                val error = routes.fails("tracker.login", obj("trackerId" to 1, "callbackUrl" to callback(mal.code)))
                assertEquals(Kind.invalid, error.kind)
                listOf(mal.access.get(), mal.refresh.get(), mal.code).forEach { assertFalse(it in error.message!!, error.message) }
                assertFalse(routes.call("tracker.list")["trackers"]!!.jsonArray[0].jsonObject["isLoggedIn"]!!.jsonPrimitive.content.toBoolean())
            }
        }
    }

    @Test
    fun malDeletesAnEntry() = runBlocking {
        val mal = FakeMal()
        Site { mal.handle(it) }.use { site ->
            Database(file).use { db ->
                val tracker = MyAnimeList(clientTo(site), TrackerStore(db).of(1))
                val routes = Trackers(db, listOf(tracker)).routes
                mal.challenge = authUrl(routes).toHttpUrl().queryParameter("code_challenge")!!
                routes.call("tracker.login", obj("trackerId" to 1, "callbackUrl" to callback(mal.code)))
                mal.entries[2L] = mapOf("status" to "reading")
                tracker.delete(eu.kanade.tachiyomi.data.track.model.Track.create(1).apply { remote_id = 2 })
                assertEquals(listOf("DELETE /v2/manga/2/my_list_status"), mal.seen.filter { it.method == "DELETE" }.map { "${it.method} ${it.path}" })
                assertTrue(mal.entries.isEmpty())
            }
        }
    }
}
