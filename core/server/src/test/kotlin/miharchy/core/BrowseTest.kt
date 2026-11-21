package miharchy.core

import eu.kanade.tachiyomi.source.model.FilterList
import eu.kanade.tachiyomi.source.model.MangasPage
import eu.kanade.tachiyomi.source.model.Page
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.SManga
import eu.kanade.tachiyomi.source.model.SMangaUpdate
import eu.kanade.tachiyomi.source.online.HttpSource
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import okhttp3.OkHttpClient
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** What the fixture site serves, set by the test. The source and the test share it through the test class path. */
object FixtureSite {
    @Volatile var base = ""
    @Volatile var chapters: List<String> = emptyList()
}

/** A source whose client adds a header the fixture site requires, as an extension's interceptor would. */
class FixtureHttp : HttpSource() {
    override val name = "Fixture HTTP"
    override val lang = "en"
    override val supportsLatest = true
    override val baseUrl get() = FixtureSite.base
    override val client: OkHttpClient = network.client.newBuilder()
        .addInterceptor { it.proceed(it.request().newBuilder().header("X-Fixture", "yes").build()) }.build()

    private fun manga(n: Int) = SManga.create().apply { url = "/m/$n"; title = "Manga $n"; thumbnail_url = "$baseUrl/cover$n.png" }
    override suspend fun getPopularManga(page: Int) = MangasPage(listOf(manga(1), manga(2)), page < 2)
    // A source that opens a WebView: the host has no app to show it.
    override suspend fun getLatestUpdates(page: Int): MangasPage { yomi.host.Protocol.send("{}"); error("unreachable") }
    override suspend fun getSearchManga(page: Int, query: String, filters: FilterList) = MangasPage(listOf(manga(1)), false)
    override suspend fun getMangaUpdate(manga: SManga, chapters: List<SChapter>, needsDetails: Boolean, needsChapters: Boolean): SMangaUpdate {
        val details = SManga.create().apply {
            url = manga.url; title = manga.title; author = "Author"; genre = "Action, Drama"; status = SManga.COMPLETED
            thumbnail_url = manga.thumbnail_url; initialized = true
        }
        return SMangaUpdate(details, FixtureSite.chapters.map { u -> SChapter.create().apply { url = u; name = "Chapter $u"; date_upload = 1_700_000_000_000 } })
    }
    override suspend fun getPageList(chapter: SChapter) = listOf(Page(0, "", "$baseUrl/page0.png"), Page(1, "", "$baseUrl/page1.png"))
    override fun getMangaUrl(manga: SManga) = baseUrl + manga.url
    override fun getChapterUrl(chapter: SChapter) = baseUrl + chapter.url
}

class BrowseTest {
    private val work = Files.createTempDirectory("browse")
    private val png = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 1, 2, 3)

    @Test
    fun aSourceBrowsesAndReadsThroughItsOwnClient() = runBlocking {
        val requests = mutableListOf<String>()
        // The site refuses a request without the source's header, so an image core fetched itself would fail.
        Site { ex ->
            synchronized(requests) { requests += ex.requestURI.path }
            if (ex.requestHeaders.getFirst("X-Fixture") == "yes" && ex.requestURI.path.endsWith(".png")) png else null
        }.use { site ->
            FixtureSite.base = site.url
            TestRepo(work, "eu.kanade.tachiyomi.extension.en.fixturehttp").use { repo ->
                val (ks, key) = repo.keystore("browse")
                repo.publish(key, 1, repo.jar(listOf(FixtureHttp::class.java), ks))
                Database(work.resolve("core.db")).use { db ->
                    val extensions = Extensions(db, TestHost.host, work.resolve("extensions"))
                    extensions.routes.call("extensionRepo.add", buildJsonObject { put("url", repo.base) })
                    extensions.routes.call("extension.install", buildJsonObject { put("pkgName", repo.pkg) })
                    var browse = Browse(db, TestHost.host, extensions, work.resolve("covers"))
                    val r = browse.routes

                    val source = r.call("source.list")["sources"]!!.jsonArray.single().jsonObject
                    assertEquals("\"Fixture HTTP (EN)\"", source["displayName"].toString())
                    assertEquals("\"NSFW\"", source["contentWarning"].toString())
                    val sid = source["id"]!!.jsonPrimitive.content
                    fun body(vararg pairs: Pair<String, Any>) = buildJsonObject {
                        put("source", sid)
                        for ((k, v) in pairs) when (v) { is Long -> put(k, v); is Int -> put(k, v); else -> put(k, v.toString()) }
                    }

                    val popular = r.call("source.popular", body("page" to 1))
                    assertEquals("true", popular["hasNextPage"].toString())
                    val first = popular["mangas"]!!.jsonArray.map { it.jsonObject }
                    assertEquals(listOf("Manga 1", "Manga 2"), first.map { it["title"]!!.jsonPrimitive.content })
                    // A second listing finds the same rows.
                    assertEquals(first.map { it["id"] }, r.call("source.popular", body("page" to 1))["mangas"]!!.jsonArray.map { it.jsonObject["id"] })
                    val id = first[0]["id"]!!.jsonPrimitive.long
                    assertEquals("\"/api/cover/$id\"", first[0]["thumbnailUrl"].toString())

                    val cover = browse.images.getValue("cover")(listOf(id.toString()))
                    assertEquals("image/png", cover.contentType)
                    assertTrue(cover.bytes.contentEquals(png))

                    FixtureSite.chapters = listOf("/c/1", "/c/2", "/c/3")
                    val refreshed = r.call("manga.refresh", buildJsonObject { put("id", id) })
                    val manga = refreshed["manga"]!!.jsonObject
                    assertEquals("\"COMPLETED\"", manga["status"].toString())
                    assertEquals("[\"Action\",\"Drama\"]", manga["genre"].toString())
                    assertEquals("\"${site.url}/m/1\"", manga["realUrl"].toString())
                    val chapters = refreshed["chapters"]!!.jsonArray.map { it.jsonObject }
                    // The source lists the newest first; the newest has the highest sourceOrder, as on Suwayomi.
                    assertEquals(listOf(3, 2, 1), chapters.map { it["sourceOrder"]!!.jsonPrimitive.content.toInt() })
                    assertEquals("\"${site.url}/c/1\"", chapters[0]["realUrl"].toString())

                    // A refresh keeps read state, adds new chapters and drops the ones the source no longer lists.
                    val read = chapters.first { it["url"]!!.jsonPrimitive.content == "/c/2" }["id"]!!.jsonPrimitive.long
                    db.run { c -> c.createStatement().use { it.executeUpdate("UPDATE chapter SET user_read = 1, user_last_page_read = 4 WHERE id = $read") } }
                    FixtureSite.chapters = listOf("/c/4", "/c/2", "/c/3")
                    r.call("manga.refresh", buildJsonObject { put("id", id) })
                    val after = r.call("chapter.list", buildJsonObject { putJsonArray("mangaIds") { add(kotlinx.serialization.json.JsonPrimitive(id)) } })["chapters"]!!.jsonArray.map { it.jsonObject }
                    assertEquals(listOf("/c/4", "/c/2", "/c/3"), after.map { it["url"]!!.jsonPrimitive.content })
                    val kept = after.single { it["id"]!!.jsonPrimitive.long == read }
                    assertEquals("true", kept["isRead"].toString())
                    assertEquals("4", kept["lastPageRead"].toString())

                    // An empty chapter list is a source failure and changes nothing.
                    FixtureSite.chapters = emptyList()
                    r.expect(Kind.source, "manga.refresh", buildJsonObject { put("id", id) })
                    assertEquals(3, r.call("manga.get", buildJsonObject { put("id", id) })["manga"]!!.jsonObject["chapters"]!!.jsonArray.size)

                    val pages = r.call("chapter.pages", buildJsonObject { put("id", read) })
                    assertEquals("[\"/api/page/$read/0\",\"/api/page/$read/1\"]", pages["pages"].toString())
                    assertEquals("4", pages["chapter"]!!.jsonObject["lastPageRead"].toString())
                    // After a restart the page list is gone from memory, and a page image fetches it again.
                    browse = Browse(db, TestHost.host, extensions, work.resolve("covers"))
                    val image = browse.images.getValue("page")(listOf(read.toString(), "1"))
                    assertEquals("image/png", image.contentType)
                    assertTrue("/page1.png" in requests)

                    r.expect(Kind.webview, "source.latest", body("page" to 1))
                    r.expect(Kind.notFound, "source.popular", buildJsonObject { put("source", "12345") })
                    r.expect(Kind.notFound, "manga.get", buildJsonObject { put("id", 999) })
                    r.expect(Kind.invalid, "source.popular", JsonObject(emptyMap()))
                }
            }
        }
    }

    @Test
    fun contentTypesComeFromTheBytes() {
        assertEquals("image/jpeg", sniff(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0)))
        assertEquals("image/webp", sniff("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ".toByteArray()))
        assertEquals("image/gif", sniff("GIF89a".toByteArray()))
        assertEquals("application/octet-stream", sniff("<html>".toByteArray()))
    }
}
