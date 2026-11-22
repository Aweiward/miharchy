package miharchy.core

import eu.kanade.tachiyomi.data.track.kitsu.Kitsu
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
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
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/** Kitsu through a local site: the password login, search, bind, update, progress, and no secret in any reply. */
class KitsuTrackerTest {
    private val work = Files.createTempDirectory("kitsu")
    private val file = work.resolve("core.db")
    private val password = "pw-${System.nanoTime()}"

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
        try { getValue(name)(input); fail("$name should fail") } catch (e: ApiError) { e }

    private suspend fun manga(db: Database, chapters: Int, read: Int): Long = db.run { c ->
        val id = c.query("INSERT INTO manga (source_id, remote_url, remote_title, user_favorite_at) VALUES (7, ?, 'M', 1) RETURNING id", "/m/${System.nanoTime()}") { it.getLong(1) }.single()
        c.batch("INSERT INTO chapter (manga_id, remote_url, remote_name, remote_chapter_number, remote_order, state_date_fetch, user_read) VALUES (?, ?, ?, ?, ?, 0, ?)",
            (1..chapters).map { i -> listOf(id, "/m/$id/$i", "Ch. $i", i.toDouble(), chapters - i, if (i <= read) 1 else 0) })
        id
    }

    private fun client(site: Site, onRequest: (String) -> Unit = {}): OkHttpClient {
        val local = site.url.toHttpUrl()
        return OkHttpClient.Builder().addInterceptor { chain ->
            onRequest(chain.request().url.encodedPath)
            chain.proceed(chain.request().newBuilder().url(chain.request().url.newBuilder().scheme("http").host(local.host).port(local.port).build()).build())
        }.build()
    }

    private fun form(body: String): Map<String, String> = body.split('&').filter { it.isNotEmpty() }.associate {
        URLDecoder.decode(it.substringBefore('='), Charsets.UTF_8) to URLDecoder.decode(it.substringAfter('=', ""), Charsets.UTF_8)
    }

    private fun mangaNode(id: Int, subtype: String = "MANGA") =
        """{"id":"$id","titles":{"preferred":"Title $id"},"chapterCount":12,"staff":{"nodes":[{"role":"Story & Art","person":{"name":"Oda"}}]},""" +
            """"posterImage":{"views":[{"name":"small","url":"http://img/$id.jpg"}],"original":{"name":"o","url":"http://img/o$id.jpg"}},""" +
            """"description":{"en":"Pirates"},"status":"CURRENT","subtype":"$subtype","startDate":"1997-07-22","slug":"title-$id","averageRating":82.5}"""

    @Test
    fun kitsuLogsInBindsAndNeverShowsItsSecrets() = runBlocking {
        val token = "tok-${System.nanoTime()}"
        val refresh = "ref-${System.nanoTime()}"
        val entries = ConcurrentHashMap<String, JsonObject>()
        val seen = mutableListOf<String>()
        val tokenCalls = AtomicInteger()
        Site { ex ->
            val raw = ex.requestBody.readBytes().decodeToString()
            when (ex.requestURI.path) {
                "/api/oauth/token" -> {
                    tokenCalls.incrementAndGet()
                    val f = form(raw)
                    if (f["grant_type"] != "password" || f["password"] != password || f["username"] != "reader@example.com" ||
                        f["client_id"] != "dd031b32d2f56c990b1425efe6c42ad847e7fe3ab46bf1299f05ecd856bdb7dd") null
                    else """{"access_token":"$token","token_type":"bearer","created_at":${System.currentTimeMillis() / 1000},"expires_in":2592000,"refresh_token":"$refresh"}""".toByteArray()
                }
                "/api/graphql" -> {
                    val body = Json.parseToJsonElement(raw).jsonObject
                    val query = body["query"]!!.jsonPrimitive.content
                    val vars = body["variables"]!!.jsonObject
                    synchronized(seen) { seen += query.substringAfter(' ').substringBefore('(').substringBefore(' ').trim() }
                    if (ex.requestHeaders.getFirst("Authorization") != "Bearer $token") return@Site """{"errors":[{"message":"Not authorized"}]}""".toByteArray()
                    when {
                        "KitsuGetCurrentAccount" in query -> """{"data":{"currentAccount":{"id":"5150","ratingSystem":"ADVANCED","profile":{"name":"Reader"}}}}"""
                        "KitsuSearchMangaByTitle" in query -> """{"data":{"searchMangaByTitle":{"nodes":[${mangaNode(1)},${mangaNode(2)},${mangaNode(3, "NOVEL")}]}}}"""
                        "KitsuFindLibManga" in query -> {
                            val id = vars["remote_id"]!!.jsonPrimitive.content
                            val e = entries[id]
                            val node = mangaNode(id.toInt()).dropLast(1)
                            """{"data":{"findMangaById":$node,"myLibraryEntry":${e?.let { "{\"id\":${it["id"]},\"private\":false,\"progress\":${it["progress"]},\"rating\":${it["rating"]},\"status\":${it["status"]},\"startedAt\":null,\"finishedAt\":null}" } ?: "null"}}}}"""
                        }
                        "KitsuAddLibManga" in query -> {
                            entries[vars["media_id"]!!.jsonPrimitive.content] = buildJsonObject {
                                put("id", "900"); put("status", vars["status"]!!); put("progress", vars["progress"]!!); put("rating", vars["rating"] ?: JsonNull)
                            }
                            """{"data":{"libraryEntry":{"create":{"errors":null,"libraryEntry":{"id":"900"}}}}}"""
                        }
                        "KitsuUpdateLibManga" in query -> {
                            val key = entries.entries.first { it.value["id"]!!.jsonPrimitive.content == vars["library_id"]!!.jsonPrimitive.content }.key
                            entries[key] = buildJsonObject {
                                put("id", entries.getValue(key)["id"]!!); put("status", vars["status"]!!); put("progress", vars["progress"]!!); put("rating", vars["rating"] ?: JsonNull)
                            }
                            """{"data":{"libraryEntry":{"update":{"errors":null,"libraryEntry":{"id":${entries.getValue(key)["id"]}}}}}}"""
                        }
                        else -> null
                    }?.toByteArray()
                }
                else -> null
            }
        }.use { site ->
            Database(file).use { db ->
                val http = client(site)
                val routes = Trackers(db, listOf(Kitsu(http, TrackerStore(db).of(3)))).routes
                val replies = mutableListOf<String>()
                suspend fun call(name: String, input: JsonObject) = routes.getValue(name)(input).also { replies += it.toString() }
                suspend fun refused(name: String, input: JsonObject) = routes.fails(name, input).also { replies += "${it.kind} ${it.message}" }

                // Username and password: no address to open.
                val listed = call("tracker.list", JsonObject(emptyMap())).jsonObject["trackers"]!!.jsonArray[0].jsonObject
                assertEquals(JsonNull, listed["authUrl"])
                assertEquals("Kitsu", listed["name"]!!.jsonPrimitive.content)
                assertEquals(Kind.invalid, refused("track.search", obj("trackerId" to 3, "query" to "x")).kind)

                // A refused login is invalid and leaves nothing logged in or stored.
                assertEquals(Kind.invalid, refused("tracker.login", obj("trackerId" to 3, "username" to "reader@example.com", "password" to "wrong-$password")).kind)
                assertEquals(0, db.run { c -> c.query("SELECT count(*) FROM tracker_pref WHERE tracker_id = 3 AND value <> ''") { it.getInt(1) }.single() })
                // A login that cannot reach Kitsu is a network failure.
                val offline = Trackers(db, listOf(Kitsu(OkHttpClient.Builder().addInterceptor { throw java.io.IOException("offline") }.build(), TrackerStore(db).of(3)))).routes
                assertEquals(Kind.network, offline.fails("tracker.login", obj("trackerId" to 3, "username" to "reader@example.com", "password" to password)).kind)

                val login = call("tracker.login", obj("trackerId" to 3, "username" to "reader@example.com", "password" to password)).jsonObject["tracker"]!!.jsonObject
                assertEquals(true, login["isLoggedIn"]!!.jsonPrimitive.content.toBoolean())
                // The username and Kitsu's user id are stored; the password is not.
                val stored = db.run { c -> c.query("SELECT key, value FROM tracker_pref WHERE tracker_id = 3") { it.getString(1) to it.getString(2) } }.toMap()
                assertEquals("reader@example.com", stored["username"])
                assertEquals("5150", stored["password"])
                assertEquals("Reader", stored["displayUsername"])
                assertEquals("advanced", stored["kitsuScoreType"])
                assertFalse(stored.values.any { password in it }, stored.toString())

                // Search drops the novel; the entry on the user's list is bound as it stands.
                val results = call("track.search", obj("trackerId" to 3, "query" to "one piece")).jsonObject["results"]!!.jsonArray
                assertEquals(listOf(1L, 2L), results.map { it.jsonObject["remoteId"]!!.jsonPrimitive.long })
                assertEquals("https://kitsu.app/manga/title-1", results[0].jsonObject["trackingUrl"]!!.jsonPrimitive.content)
                assertEquals("Manga", results[0].jsonObject["publishingType"]!!.jsonPrimitive.content)

                val fresh = manga(db, chapters = 12, read = 5)
                val bound = call("track.bind", obj("mangaId" to fresh, "trackerId" to 3, "remoteId" to 1)).jsonObject.track()
                assertEquals(listOf(1.0, 5.0, 900.0), listOf(bound.n("status"), bound.n("lastChapterRead"), bound.n("libraryId")))
                assertEquals("CURRENT", entries.getValue("1")["status"]!!.jsonPrimitive.content)

                entries["2"] = buildJsonObject { put("id", "901"); put("status", "COMPLETED"); put("progress", 7); put("rating", 14) }
                val other = manga(db, chapters = 12, read = 3)
                val existing = call("track.bind", obj("mangaId" to other, "trackerId" to 3, "remoteId" to 2)).jsonObject.track()
                assertEquals(listOf(2.0, 7.0, 14.0, 901.0), listOf(existing.n("status"), existing.n("lastChapterRead"), existing.n("score"), existing.n("libraryId")))
                assertEquals("7", "${entries.getValue("2")["progress"]}")

                // A status and a score: "8" is Kitsu's 16 on the advanced scale.
                val scored = call("track.update", obj("recordId" to bound["id"]!!.jsonPrimitive.long, "scoreString" to "8", "status" to 3)).jsonObject.track()
                assertEquals("8", scored["displayScore"]!!.jsonPrimitive.content)
                assertEquals(listOf("ON_HOLD", "16"), entries.getValue("1").let { listOf(it["status"]!!.jsonPrimitive.content, it["rating"]!!.jsonPrimitive.content) })
                // Progress pushes the highest read chapter.
                db.run { c -> c.update("UPDATE chapter SET user_read = 1 WHERE manga_id = ? AND remote_chapter_number <= 9", fresh) }
                val progress = call("track.progress", obj("mangaIds" to listOf(fresh))).jsonObject
                assertEquals(9.0, progress["tracks"]!!.jsonArray[0].jsonObject.n("lastChapterRead"))
                assertEquals("9", "${entries.getValue("1")["progress"]}")
                call("track.list", obj("mangaIds" to listOf(fresh, other)))
                call("tracker.logout", obj("trackerId" to 3))
                assertEquals(Kind.invalid, refused("track.search", obj("trackerId" to 3, "query" to "x")).kind)

                assertTrue("KitsuUpdateLibManga" in seen && "KitsuAddLibManga" in seen, seen.toString())
                // Criterion 2: no reply or error carries the token, the refresh token or the password.
                replies.forEach { assertFalse(token in it || refresh in it || password in it, it) }
                // A logout leaves no token behind.
                assertEquals(0, db.run { c -> c.query("SELECT count(*) FROM tracker_pref WHERE value LIKE ? OR value LIKE ? OR value LIKE ?", "%$token%", "%$refresh%", "%$password%") { it.getInt(1) }.single() })
                assertEquals(0, db.run { c -> c.query("SELECT count(*) FROM tracker_pref WHERE tracker_id = 3 AND key = 'token'") { it.getInt(1) }.single() })
            }
        }
    }

    @Test
    fun kitsuRefreshesAnExpiredTokenOnceAndAnOddTokenReplyLeaksNothing() = runBlocking {
        val first = "old-${System.nanoTime()}"
        val second = "new-${System.nanoTime()}"
        val refresh = "ref-${System.nanoTime()}"
        val refreshes = AtomicInteger()
        var shape = "ok"
        Site { ex ->
            val raw = ex.requestBody.readBytes().decodeToString()
            val now = System.currentTimeMillis() / 1000
            when (ex.requestURI.path) {
                "/api/oauth/token" -> {
                    val f = form(raw)
                    when (f["grant_type"]) {
                        // An access token that is already expired at the login.
                        "password" -> if (shape == "odd") """{"access_token":{"nested":"$first"},"refresh_token":"$refresh"}""" else """{"access_token":"$first","created_at":${now - 100_000},"expires_in":3600,"refresh_token":"$refresh"}"""
                        "refresh_token" -> {
                            refreshes.incrementAndGet()
                            if (f["refresh_token"] != refresh || shape == "refuse") null
                            else if (shape == "odd-refresh") """{"access_token":["$second"],"refresh_token":"$refresh"}"""
                            else """{"access_token":"$second","created_at":$now,"expires_in":2592000,"refresh_token":"$refresh"}"""
                        }
                        else -> null
                    }?.toByteArray()
                }
                "/api/graphql" -> {
                    if (ex.requestHeaders.getFirst("Authorization") != "Bearer $second") return@Site """{"errors":[{"message":"Not authorized"}]}""".toByteArray()
                    val query = Json.parseToJsonElement(raw).jsonObject["query"]!!.jsonPrimitive.content
                    when {
                        "KitsuGetCurrentAccount" in query -> """{"data":{"currentAccount":{"id":"5150","ratingSystem":"REGULAR","profile":{"name":"Reader"}}}}"""
                        "KitsuSearchMangaByTitle" in query -> """{"data":{"searchMangaByTitle":{"nodes":[]}}}"""
                        else -> null
                    }?.toByteArray()
                }
                else -> null
            }
        }.use { site ->
            Database(file).use { db ->
                val routes = Trackers(db, listOf(Kitsu(client(site), TrackerStore(db).of(3)))).routes
                val errors = mutableListOf<String>()
                suspend fun login(): ApiError? = try { routes.getValue("tracker.login")(obj("trackerId" to 3, "username" to "u", "password" to "p")); null } catch (e: ApiError) { errors += "${e.kind} ${e.message}"; e }

                // The token endpoint answers with the token in the wrong shape.
                shape = "odd"
                assertEquals(Kind.invalid, login()!!.kind)
                // The refresh answers with the token in the wrong shape, or is refused: an IOException, so a network failure.
                shape = "odd-refresh"
                assertEquals(Kind.network, login()!!.kind)
                shape = "refuse"
                assertEquals(Kind.network, login()!!.kind)
                assertEquals(0, db.run { c -> c.query("SELECT count(*) FROM tracker_pref WHERE tracker_id = 3 AND value <> ''") { it.getInt(1) }.single() })

                // The login's own call refreshes once; later calls use the new token without refreshing again.
                shape = "ok"
                refreshes.set(0)
                assertNull(login())
                repeat(3) { routes.getValue("track.search")(obj("trackerId" to 3, "query" to "x")) }
                assertEquals(1, refreshes.get())
                assertEquals("regular", db.run { c -> c.query("SELECT value FROM tracker_pref WHERE tracker_id = 3 AND key = 'kitsuScoreType'") { it.getString(1) }.single() })
                assertTrue(second in db.run { c -> c.query("SELECT value FROM tracker_pref WHERE tracker_id = 3 AND key = 'token'") { it.getString(1) }.single() })

                routes.getValue("tracker.logout")(obj("trackerId" to 3))
                errors.forEach { assertFalse(first in it || second in it || refresh in it, it) }
                assertEquals(0, db.run { c -> c.query("SELECT count(*) FROM tracker_pref WHERE value LIKE ? OR value LIKE ? OR value LIKE ?", "%$first%", "%$second%", "%$refresh%") { it.getInt(1) }.single() })
            }
        }
    }
}
