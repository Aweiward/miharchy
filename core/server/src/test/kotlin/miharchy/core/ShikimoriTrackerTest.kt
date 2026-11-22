package miharchy.core

import eu.kanade.tachiyomi.data.track.shikimori.Shikimori
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
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/** Shikimori through a local site: the code login, search, bind, update, progress, and no secret in any reply. */
class ShikimoriTrackerTest {
    private val work = Files.createTempDirectory("shikimori")
    private val file = work.resolve("core.db")
    private val code = "code-${System.nanoTime()}"

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

    /** Every request goes to the local site, whatever host it names. */
    private fun client(site: Site): OkHttpClient {
        val local = site.url.toHttpUrl()
        return OkHttpClient.Builder().addInterceptor { chain ->
            chain.proceed(chain.request().newBuilder().url(chain.request().url.newBuilder().scheme("http").host(local.host).port(local.port).build()).build())
        }.build()
    }

    private fun form(body: String): Map<String, String> = body.split('&').filter { it.isNotEmpty() }.associate {
        URLDecoder.decode(it.substringBefore('='), Charsets.UTF_8) to URLDecoder.decode(it.substringAfter('=', ""), Charsets.UTF_8)
    }

    private fun mangaNode(id: Int, extra: String = "") =
        """{"id":"$id","name":"Title $id","chapters":12,"kind":"manga","poster":{"mainUrl":"http://img/$id.jpg"},"score":8.5,"url":"https://shikimori.io/mangas/$id",""" +
            """"status":"ongoing","airedOn":{"date":"1997-07-22"},"description":"Pirates","personRoles":[{"person":{"name":"Oda"},"rolesEn":["Story & Art"]}]$extra}"""

    @Test
    fun shikimoriLogsInBindsAndNeverShowsItsSecrets() = runBlocking {
        val token = "tok-${System.nanoTime()}"
        val refresh = "ref-${System.nanoTime()}"
        val rates = ConcurrentHashMap<Long, JsonObject>()
        val seen = mutableListOf<String>()
        val agents = mutableListOf<String?>()
        Site { ex ->
            val raw = ex.requestBody.readBytes().decodeToString()
            val path = ex.requestURI.path
            if (path == "/oauth/token") {
                val f = form(raw)
                return@Site if (f["grant_type"] != "authorization_code" || f["code"] != code || f["redirect_uri"] != "https://suwayomi.org/tracker-oauth" ||
                    f["client_id"] != "qTrMBF5HtM_33Pv2Vm2fFmEaBUI_c3LvohyJ0beQ9pA" || f["client_secret"] != "MN_XHQK_aeSqduW_rB64cARi2fFoLGl-AgZ0iMD9zq0") null
                else """{"access_token":"$token","token_type":"Bearer","created_at":${System.currentTimeMillis() / 1000},"expires_in":86400,"refresh_token":"$refresh"}""".toByteArray()
            }
            synchronized(agents) { agents += ex.requestHeaders.getFirst("User-Agent") }
            if (ex.requestHeaders.getFirst("Authorization") != "Bearer $token") return@Site """{"errors":[{"message":"Not authorized"}]}""".toByteArray()
            when {
                path == "/api/graphql" -> {
                    val body = Json.parseToJsonElement(raw).jsonObject
                    val query = body["query"]!!.jsonPrimitive.content
                    val vars = body["variables"]!!.jsonObject
                    synchronized(seen) { seen += Regex("""(?:query|mutation) (\w+)""").find(query)!!.groupValues[1] }
                    when {
                        "ShikimoriGetCurrentUser" in query -> """{"data":{"currentUser":{"id":"5150","nickname":"reader"}}}"""
                        "ShikimoriSearchManga" in query -> """{"data":{"mangas":[${mangaNode(1)},${mangaNode(2)}]}}"""
                        "ShikimoriGetLibManga" in query -> {
                            val id = vars["remote_id"]!!.jsonPrimitive.long
                            val rate = rates[id]?.let { ""","userRate":{"id":"${it["id"]!!.jsonPrimitive.content}","chapters":${it["chapters"]},"status":${it["status"]},"score":${it["score"]}}""" } ?: ""","userRate":null"""
                            """{"data":{"mangas":[{"id":"$id","url":"https://shikimori.io/mangas/$id","name":"Title $id","chapters":12$rate}]}}"""
                        }
                        else -> null
                    }?.toByteArray()
                }
                path == "/api/v2/user_rates" && ex.requestMethod == "POST" -> {
                    val rate = Json.parseToJsonElement(raw).jsonObject["user_rate"]!!.jsonObject
                    assertEquals("5150", rate["user_id"]!!.jsonPrimitive.content)
                    assertEquals("Manga", rate["target_type"]!!.jsonPrimitive.content)
                    rates[rate["target_id"]!!.jsonPrimitive.long] = buildJsonObject {
                        put("id", 700); put("chapters", rate["chapters"]!!); put("status", rate["status"]!!); put("score", rate["score"]!!)
                    }
                    """{"id":700}""".toByteArray()
                }
                path.startsWith("/api/v2/user_rates/") && ex.requestMethod == "PUT" -> {
                    val id = path.substringAfterLast('/').toInt()
                    val rate = Json.parseToJsonElement(raw).jsonObject["user_rate"]!!.jsonObject
                    val key = rates.entries.first { it.value["id"]!!.jsonPrimitive.int == id }.key
                    rates[key] = buildJsonObject { put("id", id); put("chapters", rate["chapters"]!!); put("status", rate["status"]!!); put("score", rate["score"]!!) }
                    """{"id":$id}""".toByteArray()
                }
                else -> null
            }
        }.use { site ->
            Database(file).use { db ->
                val routes = Trackers(db, listOf(Shikimori(client(site), TrackerStore(db).of(4)))).routes
                val replies = mutableListOf<String>()
                suspend fun call(name: String, input: JsonObject) = routes.getValue(name)(input).also { replies += it.toString() }
                suspend fun refused(name: String, input: JsonObject) = routes.fails(name, input).also { replies += "${it.kind} ${it.message}" }
                val callback = "https://suwayomi.org/tracker-oauth?code=$code"

                // Two lists, one address, with Suwayomi's client and redirect.
                val authUrl = call("tracker.list", JsonObject(emptyMap())).jsonObject["trackers"]!!.jsonArray[0].jsonObject["authUrl"]!!.jsonPrimitive.content
                val again = call("tracker.list", JsonObject(emptyMap())).jsonObject["trackers"]!!.jsonArray[0].jsonObject["authUrl"]!!.jsonPrimitive.content
                assertEquals(authUrl, again)
                val url = authUrl.toHttpUrl()
                assertEquals("shikimori.io", url.host)
                assertEquals("/oauth/authorize", url.encodedPath)
                assertEquals(listOf("qTrMBF5HtM_33Pv2Vm2fFmEaBUI_c3LvohyJ0beQ9pA", "https://suwayomi.org/tracker-oauth", "code"),
                    listOf("client_id", "redirect_uri", "response_type").map { url.queryParameter(it) })
                assertEquals(Kind.invalid, refused("track.search", obj("trackerId" to 4, "query" to "x")).kind)

                // A code Shikimori refuses, a callback without a code, and a login that cannot reach it.
                assertEquals(Kind.invalid, refused("tracker.login", obj("trackerId" to 4, "callbackUrl" to "https://suwayomi.org/tracker-oauth?code=wrong-$code")).kind)
                assertEquals(Kind.invalid, refused("tracker.login", obj("trackerId" to 4, "callbackUrl" to "https://suwayomi.org/tracker-oauth?error=access_denied")).kind)
                val offline = Trackers(db, listOf(Shikimori(OkHttpClient.Builder().addInterceptor { throw java.io.IOException("offline") }.build(), TrackerStore(db).of(4)))).routes
                assertEquals(Kind.network, offline.fails("tracker.login", obj("trackerId" to 4, "callbackUrl" to callback)).kind)
                assertEquals(0, db.run { c -> c.query("SELECT count(*) FROM tracker_pref WHERE tracker_id = 4 AND value <> ''") { it.getInt(1) }.single() })

                val login = call("tracker.login", obj("trackerId" to 4, "callbackUrl" to callback)).jsonObject["tracker"]!!.jsonObject
                assertEquals(true, login["isLoggedIn"]!!.jsonPrimitive.content.toBoolean())
                assertEquals("Shikimori", login["name"]!!.jsonPrimitive.content)
                // The user's id is stored as the username; the OAuth object as the token.
                val stored = db.run { c -> c.query("SELECT key, value FROM tracker_pref WHERE tracker_id = 4") { it.getString(1) to it.getString(2) } }.toMap()
                assertEquals(listOf("5150", "reader"), listOf(stored["username"], stored["displayUsername"]))
                assertTrue(refresh in stored["token"]!!)

                val results = call("track.search", obj("trackerId" to 4, "query" to "one piece")).jsonObject["results"]!!.jsonArray
                assertEquals(listOf(1L, 2L), results.map { it.jsonObject["remoteId"]!!.jsonPrimitive.long })
                assertEquals(listOf("Manga", "Ongoing", "https://shikimori.io/mangas/1"), listOf("publishingType", "publishingStatus", "trackingUrl").map { results[0].jsonObject[it]!!.jsonPrimitive.content })

                // A new entry: reading, at the highest read chapter, posted to the v2 API.
                val fresh = manga(db, chapters = 12, read = 5)
                val bound = call("track.bind", obj("mangaId" to fresh, "trackerId" to 4, "remoteId" to 1)).jsonObject.track()
                assertEquals(listOf(1.0, 5.0, 700.0), listOf(bound.n("status"), bound.n("lastChapterRead"), bound.n("libraryId")))
                assertEquals("watching", rates.getValue(1)["status"]!!.jsonPrimitive.content)

                // An entry already on the user's list keeps its own status, chapter and score.
                rates[2] = buildJsonObject { put("id", 701); put("chapters", 7); put("status", "completed"); put("score", 6) }
                val other = manga(db, chapters = 12, read = 3)
                val existing = call("track.bind", obj("mangaId" to other, "trackerId" to 4, "remoteId" to 2)).jsonObject.track()
                assertEquals(listOf(2.0, 7.0, 6.0, 701.0), listOf(existing.n("status"), existing.n("lastChapterRead"), existing.n("score"), existing.n("libraryId")))

                val scored = call("track.update", obj("recordId" to bound["id"]!!.jsonPrimitive.long, "scoreString" to "8", "status" to 3)).jsonObject.track()
                assertEquals("8", scored["displayScore"]!!.jsonPrimitive.content)
                assertEquals(listOf("on_hold", 8), rates.getValue(1).let { listOf(it["status"]!!.jsonPrimitive.content, it["score"]!!.jsonPrimitive.int) })
                db.run { c -> c.update("UPDATE chapter SET user_read = 1 WHERE manga_id = ? AND remote_chapter_number <= 9", fresh) }
                val progress = call("track.progress", obj("mangaIds" to listOf(fresh))).jsonObject
                assertEquals(9.0, progress["tracks"]!!.jsonArray[0].jsonObject.n("lastChapterRead"))
                assertEquals(9, rates.getValue(1)["chapters"]!!.jsonPrimitive.int)
                call("track.list", obj("mangaIds" to listOf(fresh, other)))
                call("tracker.logout", obj("trackerId" to 4))
                assertEquals(Kind.invalid, refused("track.search", obj("trackerId" to 4, "query" to "x")).kind)

                assertTrue(seen.containsAll(listOf("ShikimoriSearchManga", "ShikimoriGetLibManga", "ShikimoriGetCurrentUser")), seen.toString())
                assertEquals(setOf<String?>("Miharchy"), agents.toSet())
                // Criterion 2: no reply or error carries the token, the refresh token or the code.
                replies.forEach { assertFalse(token in it || refresh in it || code in it, it) }
                // A logout leaves no token behind.
                assertEquals(0, db.run { c -> c.query("SELECT count(*) FROM tracker_pref WHERE value LIKE ? OR value LIKE ? OR value LIKE ?", "%$token%", "%$refresh%", "%$code%") { it.getInt(1) }.single() })
                assertEquals(0, db.run { c -> c.query("SELECT count(*) FROM tracker_pref WHERE tracker_id = 4 AND key = 'token'") { it.getInt(1) }.single() })
            }
        }
    }

    @Test
    fun shikimoriRefreshesAnExpiredTokenOnceAndAnOddTokenReplyLeaksNothing() = runBlocking {
        val first = "old-${System.nanoTime()}"
        val second = "new-${System.nanoTime()}"
        val refresh = "ref-${System.nanoTime()}"
        val refreshes = AtomicInteger()
        var shape = "ok"
        Site { ex ->
            val raw = ex.requestBody.readBytes().decodeToString()
            val now = System.currentTimeMillis() / 1000
            when (ex.requestURI.path) {
                "/oauth/token" -> {
                    val f = form(raw)
                    when (f["grant_type"]) {
                        // An access token that is already expired at the login.
                        "authorization_code" -> if (shape == "odd") """{"access_token":{"nested":"$first"},"refresh_token":"$refresh"}""" else """{"access_token":"$first","created_at":${now - 100_000},"expires_in":3600,"refresh_token":"$refresh"}"""
                        "refresh_token" -> {
                            refreshes.incrementAndGet()
                            if (f["refresh_token"] != refresh || shape == "refuse") null
                            else if (shape == "odd-refresh") """{"access_token":["$second"],"refresh_token":"$refresh"}"""
                            else """{"access_token":"$second","created_at":$now,"expires_in":86400,"refresh_token":"$refresh"}"""
                        }
                        else -> null
                    }?.toByteArray()
                }
                "/api/graphql" -> {
                    if (ex.requestHeaders.getFirst("Authorization") != "Bearer $second") return@Site """{"errors":[{"message":"Not authorized"}]}""".toByteArray()
                    val query = Json.parseToJsonElement(raw).jsonObject["query"]!!.jsonPrimitive.content
                    when {
                        "ShikimoriGetCurrentUser" in query -> """{"data":{"currentUser":{"id":"5150","nickname":"reader"}}}"""
                        "ShikimoriSearchManga" in query -> """{"data":{"mangas":[]}}"""
                        else -> null
                    }?.toByteArray()
                }
                else -> null
            }
        }.use { site ->
            Database(file).use { db ->
                val routes = Trackers(db, listOf(Shikimori(client(site), TrackerStore(db).of(4)))).routes
                val errors = mutableListOf<String>()
                suspend fun login(): ApiError? = try { routes.getValue("tracker.login")(obj("trackerId" to 4, "callbackUrl" to "https://suwayomi.org/tracker-oauth?code=$code")); null } catch (e: ApiError) { errors += "${e.kind} ${e.message}"; e }

                // The token endpoint answers with the token in the wrong shape.
                shape = "odd"
                assertEquals(Kind.invalid, login()!!.kind)
                // The refresh answers with the token in the wrong shape, or is refused: an IOException, so a network failure.
                shape = "odd-refresh"
                assertEquals(Kind.network, login()!!.kind)
                shape = "refuse"
                assertEquals(Kind.network, login()!!.kind)
                assertEquals(0, db.run { c -> c.query("SELECT count(*) FROM tracker_pref WHERE tracker_id = 4 AND value <> ''") { it.getInt(1) }.single() })

                // The login's own call refreshes once; later calls use the new token without refreshing again.
                shape = "ok"
                refreshes.set(0)
                assertNull(login())
                repeat(3) { routes.getValue("track.search")(obj("trackerId" to 4, "query" to "x")) }
                assertEquals(1, refreshes.get())
                assertTrue(second in db.run { c -> c.query("SELECT value FROM tracker_pref WHERE tracker_id = 4 AND key = 'token'") { it.getString(1) }.single() })

                routes.getValue("tracker.logout")(obj("trackerId" to 4))
                errors.forEach { assertFalse(first in it || second in it || refresh in it || code in it, it) }
                assertEquals(0, db.run { c -> c.query("SELECT count(*) FROM tracker_pref WHERE value LIKE ? OR value LIKE ? OR value LIKE ? OR value LIKE ?", "%$first%", "%$second%", "%$refresh%", "%$code%") { it.getInt(1) }.single() })
            }
        }
    }
}
