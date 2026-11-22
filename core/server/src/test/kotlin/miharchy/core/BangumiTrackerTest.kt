package miharchy.core

import eu.kanade.tachiyomi.data.track.bangumi.Bangumi
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
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import java.net.URLDecoder
import java.nio.file.Files
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Bangumi through a local site: the code login, search, bind, update and progress, and no secret in any reply. */
class BangumiTrackerTest {
    private val work = Files.createTempDirectory("bangumi")

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

    private fun form(body: String): Map<String, String> =
        body.split('&').filter { it.isNotEmpty() }.associate { it.substringBefore('=') to URLDecoder.decode(it.substringAfter('=', ""), Charsets.UTF_8) }

    private suspend fun manga(db: Database, chapters: Int, read: Int): Long = db.run { c ->
        val id = c.query("INSERT INTO manga (source_id, remote_url, remote_title, user_favorite_at) VALUES (7, ?, 'M', 1) RETURNING id", "/m/${System.nanoTime()}") { it.getLong(1) }.single()
        c.batch("INSERT INTO chapter (manga_id, remote_url, remote_name, remote_chapter_number, remote_order, state_date_fetch, user_read) VALUES (?, ?, ?, ?, ?, 0, ?)",
            (1..chapters).map { i -> listOf(id, "/m/$id/$i", "Ch. $i", i.toDouble(), chapters - i, if (i <= read) 1 else 0) })
        id
    }

    private suspend fun tokenRows(db: Database, secret: String) =
        db.run { c -> c.query("SELECT count(*) FROM tracker_pref WHERE value LIKE ?", "%$secret%") { it.getInt(1) }.single() }

    private val subject = """{"id":100,"name_cn":"海贼王","name":"One Piece","summary":" A pirate. ","date":"1997-07-22","images":{"common":"http://x/c.jpg"},"volumes":0,"eps":30,"rating":{"score":9.1},"platform":"漫画"}"""

    @Test
    fun bangumiLogsInBindsAndNeverShowsItsToken() = runBlocking {
        val code = "code-${System.nanoTime()}"
        val token = "tok-${System.nanoTime()}"
        val refresh = "ref-${System.nanoTime()}"
        val secrets = listOf(code, token, refresh, "hunter2")
        val entries = ConcurrentHashMap<Long, JsonObject>()
        entries[200] = obj("type" to 4, "rate" to 7, "ep_status" to 3)
        val seen = mutableListOf<String>()
        Site { ex ->
            val path = ex.requestURI.path
            val body = ex.requestBody.readBytes().decodeToString()
            synchronized(seen) { seen += "${ex.requestMethod} $path" }
            if (path == "/oauth/access_token") {
                val f = form(body)
                return@Site if (f["grant_type"] == "authorization_code" && f["code"] == code && f["client_id"] == "bgm376667faf473119bb" &&
                    f["client_secret"] == "d74caf0b874ddd18e6c6e7fb86d77a06" && f["redirect_uri"] == "https://suwayomi.org/tracker-oauth") {
                    """{"access_token":"$token","expires_in":604800,"token_type":"Bearer","refresh_token":"$refresh"}""".toByteArray()
                } else null
            }
            if (ex.requestHeaders.getFirst("Authorization") != "Bearer $token") return@Site null
            val id = path.substringAfterLast('/').toLongOrNull()
            when {
                path == "/v0/me" -> """{"username":"reader","nickname":"Reader"}"""
                path == "/v0/search/subjects" && "other" in body -> """{"total":1,"limit":20,"offset":0,"data":[${subject.replace("\"id\":100", "\"id\":200")}]}"""
                path == "/v0/search/subjects" -> """{"total":2,"limit":20,"offset":0,"data":[$subject,${subject.replace("\"id\":100", "\"id\":101").replace("漫画", "小说")}]}"""
                path == "/v0/subjects/100" -> subject
                path.startsWith("/v0/users/reader/collections/") ->
                    entries[id]?.let { """{"rate":${it["rate"]},"type":${it["type"]},"ep_status":${it["ep_status"]},"private":false,"subject":{"volumes":0,"eps":30}}""" }
                path.startsWith("/v0/users/-/collections/") && ex.requestMethod in listOf("POST", "PATCH") -> {
                    entries[id!!] = Json.parseToJsonElement(body).jsonObject
                    ""
                }
                else -> null
            }?.toByteArray()
        }.use { site ->
            Database(work.resolve("core.db")).use { db ->
                val routes = Trackers(db, listOf(Bangumi(local(site), TrackerStore(db).of(5)))).routes
                val replies = mutableListOf<String>()
                suspend fun call(name: String, input: JsonObject) = routes.getValue(name)(input).jsonObject.also { replies += it.toString() }
                suspend fun refused(name: String, input: JsonObject) = routes.fails(name, input).also { replies += "${it.kind} ${it.message}" }
                fun tracker() = routes.let { runBlocking { call("tracker.list", JsonObject(emptyMap())) } }["trackers"]!!.jsonArray[0].jsonObject

                val authUrl = tracker()["authUrl"]!!.jsonPrimitive.content.toHttpUrl()
                assertEquals("bgm.tv", authUrl.host)
                assertEquals(listOf("bgm376667faf473119bb", "code", "https://suwayomi.org/tracker-oauth"),
                    listOf(authUrl.queryParameter("client_id"), authUrl.queryParameter("response_type"), authUrl.queryParameter("redirect_uri")))
                assertEquals(false, tracker()["isLoggedIn"]!!.jsonPrimitive.content.toBoolean())

                // A refused code is invalid, and leaves nothing behind.
                assertEquals(Kind.invalid, refused("tracker.login", obj("trackerId" to 5, "callbackUrl" to "https://suwayomi.org/tracker-oauth?code=wrong-$code")).kind)
                assertEquals(0, db.run { c -> c.query("SELECT count(*) FROM tracker_pref WHERE value <> ''") { it.getInt(1) }.single() })

                val loggedIn = call("tracker.login", obj("trackerId" to 5, "callbackUrl" to "https://suwayomi.org/tracker-oauth?code=$code&state=x"))["tracker"]!!.jsonObject
                assertTrue(loggedIn["isLoggedIn"]!!.jsonPrimitive.content.toBoolean())
                // The OAuth object, the user name and the token as password are stored; the token is JSON with both tokens.
                assertEquals(1, tokenRows(db, refresh))
                assertEquals("reader", db.run { c -> c.query("SELECT value FROM tracker_pref WHERE tracker_id = 5 AND key = 'username'") { it.getString(1) }.single() })

                val m = manga(db, chapters = 12, read = 5)
                val found = call("track.search", obj("trackerId" to 5, "query" to "one piece"))["results"]!!.jsonArray
                assertEquals(listOf(100L), found.map { it.jsonObject["remoteId"]!!.jsonPrimitive.long })
                assertEquals("海贼王", found[0].jsonObject["title"]!!.jsonPrimitive.content)
                assertEquals("https://bangumi.tv/subject/100", found[0].jsonObject["trackingUrl"]!!.jsonPrimitive.content)

                // A new entry: the manga has read chapters, so it is Reading (3), then the read chapters go up.
                val bound = call("track.bind", obj("mangaId" to m, "trackerId" to 5, "remoteId" to 100)).track()
                assertEquals(listOf(3.0, 5.0), listOf(bound.n("status"), bound.n("lastChapterRead")))
                assertEquals(listOf(3, 5), entries.getValue(100).let { listOf(it["type"]!!.jsonPrimitive.int, it["ep_status"]!!.jsonPrimitive.int) })

                val scored = call("track.update", obj("recordId" to bound["id"]!!.jsonPrimitive.long, "scoreString" to "8", "status" to 4)).track()
                assertEquals("8", scored["displayScore"]!!.jsonPrimitive.content)
                assertEquals(listOf(4, 8), entries.getValue(100).let { listOf(it["type"]!!.jsonPrimitive.int, it["rate"]!!.jsonPrimitive.int) })
                assertEquals(Kind.invalid, refused("track.update", obj("recordId" to bound["id"]!!.jsonPrimitive.long, "status" to 99)).kind)

                // Progress: the user reads on, and the tracker follows.
                db.run { c -> c.update("UPDATE chapter SET user_read = 1 WHERE manga_id = ? AND remote_chapter_number <= 9", m) }
                val progressed = call("track.progress", obj("mangaIds" to listOf(m)))["tracks"]!!.jsonArray[0].jsonObject
                assertEquals(9.0, progressed.n("lastChapterRead"))
                assertEquals(9, entries.getValue(100)["ep_status"]!!.jsonPrimitive.int)

                // An entry already on the user's list is read, not overwritten: its status, score and chapters come in.
                val other = manga(db, chapters = 40, read = 0)
                call("track.search", obj("trackerId" to 5, "query" to "other"))
                val existing = call("track.bind", obj("mangaId" to other, "trackerId" to 5, "remoteId" to 200)).track()
                assertEquals(listOf(4.0, 7.0, 3.0, 30.0), listOf("status", "score", "lastChapterRead", "totalChapters").map { existing.n(it) })

                call("track.list", obj("mangaIds" to listOf(m)))
                call("tracker.logout", obj("trackerId" to 5))
                assertEquals(Kind.invalid, refused("track.search", obj("trackerId" to 5, "query" to "x")).kind)
                assertTrue("GET /v0/users/reader/collections/100" in seen && "POST /v0/users/-/collections/100" in seen && "PATCH /v0/users/-/collections/100" in seen, seen.toString())

                // Criterion 2: no reply or error carries a secret.
                replies.forEach { r -> secrets.forEach { assertFalse(it in r, r) } }
                secrets.forEach { assertEquals(0, tokenRows(db, it), it) }
                assertEquals(0, db.run { c -> c.query("SELECT count(*) FROM tracker_pref WHERE key IN ('token', 'password') AND value <> ''") { it.getInt(1) }.single() })
            }
        }
    }

    @Test
    fun aTokenEndpointInTheWrongShapeLeaksNothing() = runBlocking {
        val leak = "leak-${System.nanoTime()}"
        var shape = 0
        Site { ex ->
            ex.requestBody.readBytes()
            if (ex.requestURI.path != "/oauth/access_token") return@Site null
            when (shape++ % 3) {
                0 -> """{"access_token":{"v":"$leak"},"expires_in":1,"refresh_token":"$leak"}"""
                1 -> """{"access_token":"$leak"}"""
                else -> """["$leak"]"""
            }.toByteArray()
        }.use { site ->
            Database(work.resolve("shape.db")).use { db ->
                val routes = Trackers(db, listOf(Bangumi(local(site), TrackerStore(db).of(5)))).routes
                repeat(3) {
                    val e = routes.fails("tracker.login", obj("trackerId" to 5, "callbackUrl" to "https://suwayomi.org/tracker-oauth?code=c$it"))
                    assertEquals(Kind.invalid, e.kind)
                    assertFalse(leak in e.message.orEmpty(), e.message)
                }
                assertEquals(0, tokenRows(db, leak))
                assertFalse(routes.getValue("tracker.list")(JsonObject(emptyMap())).toString().contains(leak))
            }
        }
    }

    @Test
    fun anExpiredTokenIsRefreshedOnceAndAFailedRefreshIsANetworkError() = runBlocking {
        val old = "old-${System.nanoTime()}"
        val fresh = "new-${System.nanoTime()}"
        val refresh = "ref-${System.nanoTime()}"
        val refreshes = AtomicInteger()
        val leak = "leak-${System.nanoTime()}"
        var refreshWorks = true
        var wrongShape = false
        Site { ex ->
            val body = ex.requestBody.readBytes().decodeToString()
            when {
                ex.requestURI.path == "/oauth/access_token" && wrongShape -> """["$leak"]""".toByteArray()
                ex.requestURI.path == "/oauth/access_token" -> {
                    val f = form(body)
                    if (refreshWorks && f["grant_type"] == "refresh_token" && f["refresh_token"] == refresh) {
                        refreshes.incrementAndGet()
                        """{"access_token":"$fresh","expires_in":604800,"refresh_token":"$refresh-2"}""".toByteArray()
                    } else null
                }
                ex.requestHeaders.getFirst("Authorization") == "Bearer $fresh" -> """{"total":0,"limit":20,"offset":0,"data":[]}""".toByteArray()
                else -> null
            }
        }.use { site ->
            Database(work.resolve("refresh.db")).use { db ->
                val prefs = TrackerStore(db).of(5)
                prefs["token"] = """{"access_token":"$old","created_at":0,"expires_in":1,"refresh_token":"$refresh"}"""
                prefs["username"] = "reader"
                prefs["password"] = old
                val routes = Trackers(db, listOf(Bangumi(local(site), prefs))).routes
                routes.call("track.search", obj("trackerId" to 5, "query" to "a"))
                routes.call("track.search", obj("trackerId" to 5, "query" to "b"))
                assertEquals(1, refreshes.get())
                assertEquals(1, tokenRows(db, "$refresh-2"))
                assertEquals(0, tokenRows(db, "\"access_token\":\"$old"))

                // A refresh the site refuses is a network failure with no token in its message.
                prefs["token"] = """{"access_token":"$fresh","created_at":0,"expires_in":1,"refresh_token":"$refresh-2"}"""
                val later = Trackers(db, listOf(Bangumi(local(site), prefs))).routes
                refreshWorks = false
                val e = later.fails("track.search", obj("trackerId" to 5, "query" to "c"))
                assertEquals(Kind.network, e.kind)
                listOf(old, fresh, refresh).forEach { assertFalse(it in e.message.orEmpty(), e.message) }

                // A refresh answered in the wrong shape is a network failure too, and its message does not quote the reply.
                wrongShape = true
                val shaped = Trackers(db, listOf(Bangumi(local(site), prefs))).routes.fails("track.search", obj("trackerId" to 5, "query" to "d"))
                assertEquals(Kind.network, shaped.kind)
                assertFalse(leak in shaped.message.orEmpty(), shaped.message)
                assertEquals(0, tokenRows(db, leak))
            }
        }
    }
}
