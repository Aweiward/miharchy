package miharchy.core

import eu.kanade.tachiyomi.data.track.mangabaka.MangaBaka
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
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/** MangaBaka through a local site: the PKCE login, search, bind, update, progress and refresh, and no secret in any reply. */
class MangaBakaTrackerTest {
    private val work = Files.createTempDirectory("mangabaka")

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

    private fun challengeOf(verifier: String) =
        Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()))

    private suspend fun manga(db: Database, chapters: Int, read: Int): Long = db.run { c ->
        val id = c.query("INSERT INTO manga (source_id, remote_url, remote_title, user_favorite_at) VALUES (7, ?, 'M', 1) RETURNING id", "/m/${System.nanoTime()}") { it.getLong(1) }.single()
        c.batch("INSERT INTO chapter (manga_id, remote_url, remote_name, remote_chapter_number, remote_order, state_date_fetch, user_read) VALUES (?, ?, ?, ?, ?, 0, ?)",
            (1..chapters).map { i -> listOf(id, "/m/$id/$i", "Ch. $i", i.toDouble(), chapters - i, if (i <= read) 1 else 0) })
        id
    }

    private suspend fun rows(db: Database, secret: String) =
        db.run { c -> c.query("SELECT count(*) FROM tracker_pref WHERE value LIKE ?", "%$secret%") { it.getInt(1) }.single() }

    private fun item(id: Int) = """{"id":$id,"cover":{"x250":{"x1":"http://x/c.jpg"}},"authors":["Oda"],"artists":["Oda"],"description":" A pirate. ","published":{"start_date":"1997-07-22"},"status":"releasing","type":"manga","rating":9.1234,"titles":[{"language":"ja","traits":[],"title":"ワンピース","is_primary":false},{"language":"en","traits":["official"],"title":"One Piece","is_primary":true}]}"""

    @Test
    fun mangaBakaLogsInWithPkceBindsAndNeverShowsItsToken() = runBlocking {
        val code = "code-${System.nanoTime()}"
        val token = "tok-${System.nanoTime()}"
        val refresh = "ref-${System.nanoTime()}"
        var challenge = ""
        val verifiers = mutableListOf<String>()
        val library = ConcurrentHashMap<Long, JsonObject>()
        library[400] = obj("state" to "paused", "is_private" to false, "progress_chapter" to 17.5, "rating" to 60, "start_date" to "2024-03-05T00:00:00Z")
        val seen = mutableListOf<String>()
        Site { ex ->
            val path = ex.requestURI.path
            val body = ex.requestBody.readBytes().decodeToString()
            synchronized(seen) { seen += "${ex.requestMethod} $path" }
            if (path == "/auth/oauth2/token") {
                val f = form(body)
                if (f["grant_type"] != "authorization_code" || f["code"] != code || f["client_id"] != "XPHAGXckIvAkFyoJqgqDbRcaKdQgUTMK" ||
                    f["redirect_uri"] != "https://suwayomi.org/tracker-oauth" || f["code_challenge_method"] != "S256" ||
                    f["scope"] != "library.read library.write offline_access openid") return@Site null
                synchronized(verifiers) { verifiers += f["code_verifier"]!! }
                // The verifier must hash to the challenge of the address the user opened.
                return@Site if (challengeOf(f["code_verifier"]!!) == challenge) {
                    """{"access_token":"$token","refresh_token":"$refresh","expires_at":${System.currentTimeMillis() / 1000 + 3600},"token_type":"Bearer"}""".toByteArray()
                } else null
            }
            val id = path.substringAfterLast('/').toLongOrNull()
            when {
                path == "/v1/series/search" -> """{"data":[${item(400)}]}"""
                ex.requestHeaders.getFirst("Authorization") != "Bearer $token" -> null
                path == "/v1/my/profile" -> """{"data":{"id":"u1","rating_steps":5,"nickname":"Reader","preferred_username":null}}"""
                path.startsWith("/v1/series/") -> """{"data":${item(id!!.toInt())}}"""
                path.startsWith("/v1/my/library/") -> when (ex.requestMethod) {
                    "GET" -> library[id]?.let { """{"data":{"state":${it["state"]},"start_date":${it["start_date"] ?: JsonNull},"finish_date":null,"is_private":${it["is_private"]},"progress_chapter":${it["progress_chapter"] ?: JsonNull},"rating":${it["rating"] ?: JsonNull}}}""" }
                    "POST", "PUT" -> { library[id!!] = Json.parseToJsonElement(body).jsonObject; """{"status":201,"data":true}""" }
                    else -> null
                }
                else -> null
            }?.toByteArray()
        }.use { site ->
            Database(work.resolve("core.db")).use { db ->
                val routes = Trackers(db, listOf(MangaBaka(local(site), TrackerStore(db).of(11)))).routes
                val replies = mutableListOf<String>()
                suspend fun call(name: String, input: JsonObject) = routes.getValue(name)(input).jsonObject.also { replies += it.toString() }
                suspend fun refused(name: String, input: JsonObject) = routes.fails(name, input).also { replies += "${it.kind} ${it.message}" }
                suspend fun authUrl() = call("tracker.list", JsonObject(emptyMap()))["trackers"]!!.jsonArray[0].jsonObject["authUrl"]!!.jsonPrimitive.content

                // The address carries Suwayomi's client, and is the same on every list until the login ends.
                val first = authUrl()
                assertEquals(first, authUrl())
                val a = first.toHttpUrl()
                assertEquals("mangabaka.org", a.host)
                assertEquals(
                    listOf("XPHAGXckIvAkFyoJqgqDbRcaKdQgUTMK", "S256", "code", "library.read library.write offline_access openid", "https://suwayomi.org/tracker-oauth"),
                    listOf("client_id", "code_challenge_method", "response_type", "scope", "redirect_uri").map { a.queryParameter(it) },
                )
                challenge = a.queryParameter("code_challenge")!!

                // A callback without a code does nothing; the address stays the same.
                assertEquals(Kind.invalid, refused("tracker.login", obj("trackerId" to 11, "callbackUrl" to "https://suwayomi.org/tracker-oauth")).kind)
                assertEquals(first, authUrl())
                // A refused code ends that login: the next address has a new challenge.
                assertEquals(Kind.invalid, refused("tracker.login", obj("trackerId" to 11, "callbackUrl" to "https://suwayomi.org/tracker-oauth?code=wrong-$code")).kind)
                assertEquals(0, db.run { c -> c.query("SELECT count(*) FROM tracker_pref WHERE key IN ('token', 'password') AND value <> ''") { it.getInt(1) }.single() })
                val second = authUrl()
                assertNotEquals(first, second)
                assertEquals(second, authUrl())
                val b = second.toHttpUrl()
                challenge = b.queryParameter("code_challenge")!!

                val login = call("tracker.login", obj("trackerId" to 11, "callbackUrl" to "https://suwayomi.org/tracker-oauth?code=$code"))["tracker"]!!.jsonObject
                assertTrue(login["isLoggedIn"]!!.jsonPrimitive.content.toBoolean())
                assertEquals(JsonNull, login["authUrl"])
                // The OAuth object, the fixed user name, the score step and the display name are stored.
                assertEquals(1, rows(db, refresh))
                fun pref(key: String) = runBlocking { db.run { c -> c.query("SELECT value FROM tracker_pref WHERE tracker_id = 11 AND key = ?", key) { it.getString(1) }.single() } }
                assertEquals(listOf("user", "STEP_5", "Reader"), listOf(pref("username"), pref("mangabakaScoreType"), pref("displayUsername")))
                assertEquals(21, login["scores"]!!.jsonArray.size)

                val m = manga(db, chapters = 12, read = 5)
                val found = call("track.search", obj("trackerId" to 11, "query" to "one piece"))["results"]!!.jsonArray[0].jsonObject
                assertEquals(listOf(400L, "One Piece", "Manga", "https://mangabaka.org/400"),
                    listOf(found["remoteId"]!!.jsonPrimitive.long, found["title"]!!.jsonPrimitive.content, found["publishingType"]!!.jsonPrimitive.content, found["trackingUrl"]!!.jsonPrimitive.content))

                // An entry already on the user's list is read, not overwritten.
                val existing = call("track.bind", obj("mangaId" to manga(db, chapters = 30, read = 0), "trackerId" to 11, "remoteId" to 400)).track()
                assertEquals(listOf(3.0, 17.5, 60.0), listOf("status", "lastChapterRead", "score").map { existing.n(it) })
                assertTrue(existing["startDate"]!!.jsonPrimitive.long > 0)

                // A new entry: added as Reading with is_private, then the read chapters go up.
                library.remove(400)
                val bound = call("track.bind", obj("mangaId" to m, "trackerId" to 11, "remoteId" to 400, "private" to true)).track()
                assertEquals(listOf(1.0, 5.0), listOf(bound.n("status"), bound.n("lastChapterRead")))
                assertEquals(listOf("reading", 5.0, "true"), library.getValue(400).let { listOf(it["state"]!!.jsonPrimitive.content, it["progress_chapter"]!!.jsonPrimitive.double, it["is_private"]!!.jsonPrimitive.content) })

                val scored = call("track.update", obj("recordId" to bound["id"]!!.jsonPrimitive.long, "scoreString" to "85", "status" to 3)).track()
                assertEquals("85", scored["displayScore"]!!.jsonPrimitive.content)
                assertEquals(listOf("paused", 85.0), library.getValue(400).let { listOf(it["state"]!!.jsonPrimitive.content, it["rating"]!!.jsonPrimitive.double) })
                assertEquals(Kind.invalid, refused("track.update", obj("recordId" to bound["id"]!!.jsonPrimitive.long, "scoreString" to "86")).kind)

                db.run { c -> c.update("UPDATE chapter SET user_read = 1 WHERE manga_id = ? AND remote_chapter_number <= 9", m) }
                val progressed = call("track.progress", obj("mangaIds" to listOf(m)))["tracks"]!!.jsonArray[0].jsonObject
                assertEquals(9.0, progressed.n("lastChapterRead"))
                assertEquals(9.0, library.getValue(400)["progress_chapter"]!!.jsonPrimitive.double)

                call("track.list", obj("mangaIds" to listOf(m)))
                call("tracker.logout", obj("trackerId" to 11))
                assertEquals(Kind.invalid, refused("track.update", obj("recordId" to bound["id"]!!.jsonPrimitive.long)).kind)
                // After the logout the next address is a new login.
                assertNotEquals(second, authUrl())
                assertTrue("POST /v1/my/library/400" in seen && "PUT /v1/my/library/400" in seen && "GET /v1/my/profile" in seen, seen.toString())

                // Criterion 2: no reply or error carries the token, the refresh token, the code or the verifier.
                val secrets = listOf(token, refresh, code) + verifiers
                assertEquals(1, verifiers.size)
                replies.forEach { r -> secrets.forEach { assertFalse(it in r, r) } }
                secrets.forEach { assertEquals(0, rows(db, it), it) }
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
            if (ex.requestURI.path != "/auth/oauth2/token") return@Site null
            when (shape++ % 3) {
                0 -> """{"access_token":{"v":"$leak"},"refresh_token":"$leak","expires_at":"$leak"}"""
                1 -> """{"access_token":"$leak"}"""
                else -> """["$leak"]"""
            }.toByteArray()
        }.use { site ->
            Database(work.resolve("shape.db")).use { db ->
                val routes = Trackers(db, listOf(MangaBaka(local(site), TrackerStore(db).of(11)))).routes
                repeat(3) {
                    routes.getValue("tracker.list")(JsonObject(emptyMap()))
                    val e = routes.fails("tracker.login", obj("trackerId" to 11, "callbackUrl" to "https://suwayomi.org/tracker-oauth?code=c$it"))
                    assertEquals(Kind.invalid, e.kind)
                    assertFalse(leak in e.message.orEmpty(), e.message)
                }
                assertEquals(0, rows(db, leak))
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
                ex.requestURI.path == "/auth/oauth2/token" && wrongShape -> """["$leak"]""".toByteArray()
                ex.requestURI.path == "/auth/oauth2/token" -> {
                    val f = form(body)
                    if (refreshWorks && f["grant_type"] == "refresh_token" && f["refresh_token"] == refresh) {
                        refreshes.incrementAndGet()
                        """{"access_token":"$fresh","refresh_token":"$refresh-2","expires_at":${System.currentTimeMillis() / 1000 + 3600}}""".toByteArray()
                    } else null
                }
                ex.requestURI.path.startsWith("/v1/series/") && ex.requestHeaders.getFirst("Authorization") == "Bearer $fresh" -> """{"data":${item(400)}}""".toByteArray()
                else -> null
            }
        }.use { site ->
            Database(work.resolve("refresh.db")).use { db ->
                val prefs = TrackerStore(db).of(11)
                prefs["token"] = """{"access_token":"$old","refresh_token":"$refresh","expires_at":0}"""
                prefs["username"] = "user"
                prefs["password"] = old
                val routes = Trackers(db, listOf(MangaBaka(local(site), prefs))).routes
                // "id:400" reads the series with the token, so the call needs a refresh first.
                routes.call("track.search", obj("trackerId" to 11, "query" to "id:400"))
                routes.call("track.search", obj("trackerId" to 11, "query" to "id:400"))
                assertEquals(1, refreshes.get())
                assertEquals(1, rows(db, "$refresh-2"))
                assertEquals(0, rows(db, "\"access_token\":\"$old"))

                // A refresh the site refuses is a network failure with no token in its message.
                prefs["token"] = """{"access_token":"$fresh","refresh_token":"$refresh-2","expires_at":0}"""
                val later = Trackers(db, listOf(MangaBaka(local(site), prefs))).routes
                refreshWorks = false
                val e = later.fails("track.search", obj("trackerId" to 11, "query" to "id:400"))
                assertEquals(Kind.network, e.kind)
                listOf(old, fresh, refresh).forEach { assertFalse(it in e.message.orEmpty(), e.message) }

                // A refresh answered in the wrong shape is a network failure too, and its message does not quote the reply.
                wrongShape = true
                val shaped = Trackers(db, listOf(MangaBaka(local(site), prefs))).routes.fails("track.search", obj("trackerId" to 11, "query" to "id:400"))
                assertEquals(Kind.network, shaped.kind)
                assertFalse(leak in shaped.message.orEmpty(), shaped.message)
                assertEquals(0, rows(db, leak))
            }
        }
    }
}
