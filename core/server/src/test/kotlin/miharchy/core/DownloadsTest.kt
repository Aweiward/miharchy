package miharchy.core

import eu.kanade.tachiyomi.source.model.MangasPage
import eu.kanade.tachiyomi.source.model.Page
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.SManga
import eu.kanade.tachiyomi.source.model.SMangaUpdate
import eu.kanade.tachiyomi.source.model.FilterList
import eu.kanade.tachiyomi.source.online.HttpSource
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import kotlinx.serialization.json.double
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

object DownloadSite {
    @Volatile var base = ""
}

/** Chapter /c/ok has two pages, /c/empty none, and /c/html an error page where its second page should be. */
class FixtureDownloads : HttpSource() {
    override val name = "Fixture Downloads"
    override val lang = "en"
    override val supportsLatest = false
    override val baseUrl get() = DownloadSite.base

    override suspend fun getPopularManga(page: Int) = MangasPage(listOf(SManga.create().apply { url = "/m/1"; title = "Manga: 1/2" }), false)
    override suspend fun getLatestUpdates(page: Int) = getPopularManga(page)
    override suspend fun getSearchManga(page: Int, query: String, filters: FilterList) = getPopularManga(page)
    override suspend fun getMangaUpdate(manga: SManga, chapters: List<SChapter>, needsDetails: Boolean, needsChapters: Boolean): SMangaUpdate {
        val details = SManga.create().apply { url = manga.url; title = manga.title; initialized = true }
        val list = listOf("/c/ok" to "Chapter 1", "/c/twin" to "Chapter 1", "/c/empty" to "Chapter 2", "/c/html" to "Chapter 3")
        return SMangaUpdate(details, list.map { (u, n) -> SChapter.create().apply { url = u; name = n; date_upload = 1_700_000_000_000 } })
    }
    override suspend fun getPageList(chapter: SChapter) = when (chapter.url) {
        "/c/empty" -> emptyList()
        "/c/html" -> listOf(Page(0, "", "$baseUrl/p0.png"), Page(1, "", "$baseUrl/error.html"))
        else -> listOf(Page(0, "", "$baseUrl/p0.png"), Page(1, "", "$baseUrl/p1.png"))
    }
    override fun getMangaUrl(manga: SManga) = baseUrl + manga.url
    override fun getChapterUrl(chapter: SChapter) = baseUrl + chapter.url
}

class DownloadsTest {
    private val work = Files.createTempDirectory("downloads")
    private val png = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 9, 9)

    private fun ids(vararg ids: Long) = buildJsonObject { put("ids", JsonArray(ids.map(::JsonPrimitive))) }
    private fun JsonObject.queue() = this["queue"]!!.jsonArray.map { it.jsonObject }
    private fun JsonObject.chapterId() = this["chapter"]!!.jsonObject["id"]!!.jsonPrimitive.long

    /** Waits on the downloads topic until the downloader has nothing left to try. */
    private suspend fun Downloads.idle(): JsonObject = withTimeout(30_000) {
        status.first { s -> s is JsonObject && s["state"]!!.jsonPrimitive.content == "STOPPED" && s.queue().none { it["state"]!!.jsonPrimitive.content != "ERROR" } }.jsonObject
    }

    @Test
    fun theQueueDownloadsKeepsReasonsAndReadsOffline() = runBlocking {
        val requests = mutableListOf<String>()
        // Set, it holds every second page, so a download waits half done.
        val hold = AtomicReference<CountDownLatch?>(null)
        Site { ex ->
            synchronized(requests) { requests += ex.requestURI.path }
            when (ex.requestURI.path) {
                "/p0.png" -> png
                "/p1.png" -> png.also { hold.get()?.await(20, TimeUnit.SECONDS) }
                "/error.html" -> "<html>blocked</html>".toByteArray()
                else -> null
            }
        }.use { site ->
            DownloadSite.base = site.url
            TestRepo(work, "eu.kanade.tachiyomi.extension.en.fixturedownloads").use { repo ->
                val (ks, key) = repo.keystore("downloads")
                repo.publish(key, 1, repo.jar(listOf(FixtureDownloads::class.java), ks))
                Database(work.resolve("core.db")).use { db ->
                    val extensions = Extensions(db, TestHost.host, work.resolve("extensions"))
                    extensions.routes.call("extensionRepo.add", buildJsonObject { put("url", repo.base) })
                    extensions.routes.call("extension.install", buildJsonObject { put("pkgName", repo.pkg) })
                    val root = work.resolve("downloads")
                    val browse = Browse(db, TestHost.host, extensions, work.resolve("covers"), root)
                    val sid = browse.routes.call("source.list")["sources"]!!.jsonArray.single().jsonObject["id"]!!.jsonPrimitive.content
                    val mangaId = browse.routes.call("source.popular", buildJsonObject { put("source", sid); put("page", 1) })["mangas"]!!.jsonArray.single().jsonObject["id"]!!.jsonPrimitive.long
                    val chapters = browse.routes.call("manga.refresh", buildJsonObject { put("id", mangaId) })["chapters"]!!.jsonArray.map { it.jsonObject }
                    fun chapter(url: String) = chapters.single { it["url"]!!.jsonPrimitive.content == url }["id"]!!.jsonPrimitive.long
                    val (ok, twin, empty, html) = listOf("/c/ok", "/c/twin", "/c/empty", "/c/html").map(::chapter)

                    var downloads = Downloads(db, browse, extensions, root)
                    assertEquals("STOPPED", downloads.routes.call("download.queue")["state"]!!.jsonPrimitive.content)
                    val started = downloads.routes.call("download.enqueue", ids(ok, twin, empty, html))
                    assertEquals("STARTED", started["state"]!!.jsonPrimitive.content)
                    assertEquals(listOf(ok, twin, empty, html), started.queue().map { it.chapterId() })

                    // A failed chapter keeps its reason and does not stop the next one.
                    val after = downloads.idle()
                    assertEquals(listOf(empty, html), after.queue().map { it.chapterId() })
                    val reasons = after.queue().map { it["error"]!!.jsonObject["message"]!!.jsonPrimitive.content to it["tries"].toString() }
                    assertEquals("Chapter does not have any pages to download" to "1", reasons[0])
                    assertTrue(reasons[1].first.startsWith("Page 2 of Fixture Downloads (EN) is not an image"), reasons[1].first)

                    // Mihon's names: the title's ':' and '/' become '_', and the second "Chapter 1" gets the url hash.
                    val dir = root.resolve("Fixture Downloads (EN)/Manga_ 1_2")
                    assertEquals(listOf("Chapter 1.cbz", "Chapter 1_" + md5("/c/twin").take(6) + ".cbz"), Files.list(dir).use { s -> s.map { it.fileName.toString() }.sorted().toList() })
                    assertEquals(listOf("001.png", "002.png"), cbzPages(dir.resolve("Chapter 1.cbz")))
                    val rows = browse.routes.call("chapter.list", ids(ok, empty))["chapters"]!!.jsonArray.map { it.jsonObject["isDownloaded"].toString() }
                    assertEquals(listOf("true", "false"), rows)
                    val library = Library(db, extensions).routes
                    library.call("manga.update", buildJsonObject { put("ids", JsonArray(listOf(JsonPrimitive(mangaId)))); put("inLibrary", true) })
                    assertEquals("2", library.call("library.list")["mangas"]!!.jsonArray.single().jsonObject["downloadCount"].toString())

                    // A retry goes back in line where it is and keeps its tries.
                    downloads.routes.call("download.enqueue", ids(empty))
                    assertEquals("2", downloads.idle().queue().first { it.chapterId() == empty }["tries"].toString())

                    // The order survives a restart, stopped.
                    downloads.routes.call("download.reorder", buildJsonObject { put("chapterId", html); put("to", 0) })
                    downloads = Downloads(db, browse, extensions, root)
                    val restarted = downloads.routes.call("download.queue")
                    assertEquals("STOPPED", restarted["state"]!!.jsonPrimitive.content)
                    assertEquals(listOf(html, empty), restarted.queue().map { it.chapterId() })

                    // The reader reads a downloaded chapter with no network: a new Browse has no page list cached.
                    val before = synchronized(requests) { requests.size }
                    val offline = Browse(db, TestHost.host, extensions, work.resolve("covers"), root)
                    assertEquals(2, offline.routes.call("chapter.pages", buildJsonObject { put("id", ok) })["pages"]!!.jsonArray.size)
                    assertTrue(offline.images.getValue("page")(listOf(ok.toString(), "1")).bytes.contentEquals(png))
                    assertEquals(before, synchronized(requests) { requests.size }, "no request reached the site")

                    // Delete takes the file and the flag.
                    val deleted = downloads.routes.call("download.delete", ids(ok))["chapters"]!!.jsonArray.single().jsonObject
                    assertEquals("false", deleted["isDownloaded"].toString())
                    assertTrue(!Files.exists(dir.resolve("Chapter 1.cbz")))

                    // Stop and dequeue cancel a running download: no .part and no .cbz stay.
                    fun parts() = Files.walk(root).use { s -> s.filter { it.toString().endsWith(".part") }.count() }
                    suspend fun halfDone() = withTimeout(20_000) {
                        downloads.status.first { s -> s is JsonObject && s.queue().any { it.chapterId() == ok && it["progress"]!!.jsonPrimitive.double == 0.5 } }
                    }
                    for (cancel in listOf("download.stop", "download.dequeue")) {
                        val latch = CountDownLatch(1).also(hold::set)
                        downloads.routes.call("download.enqueue", ids(ok))
                        halfDone()
                        val after = downloads.routes.call(cancel, ids(ok))
                        latch.countDown()
                        assertEquals(if (cancel == "download.stop") listOf("QUEUED") else emptyList(), after.queue().filter { it.chapterId() == ok }.map { it["state"]!!.jsonPrimitive.content }, cancel)
                        assertEquals(0L, parts(), cancel)
                        assertTrue(!Files.exists(dir.resolve("Chapter 1.cbz")), cancel)
                    }
                    hold.set(null)

                    // Enqueues that land as the worker stops never leave a queue that says STARTED and waits.
                    repeat(300) { downloads.routes.call("download.enqueue", ids(empty)) }
                    assertEquals("STOPPED", downloads.idle()["state"]!!.jsonPrimitive.content)
                    assertEquals(0, downloads.routes.call("download.clear").queue().size)
                    downloads.routes.expect(Kind.notFound, "download.enqueue", ids(999))
                    downloads.routes.expect(Kind.notFound, "download.reorder", buildJsonObject { put("chapterId", ok); put("to", 0) })
                }
            }
        }
    }

    @Test
    fun namesStayInsideTheDownloadsFolder() {
        assertEquals("(invalid)", validName(".."))
        assertEquals("a_b_c", validName("a/b:c"))
        assertEquals("Ch. 1", chapterDirName("Ch. 1", " "))
        assertEquals("Group_Ch. 1", chapterDirName("Ch. 1", "Group"))
        assertEquals(240, validName("é".repeat(200)).toByteArray().size)
        assertFailsWith<ApiError> { inside(work, "../x.cbz") }
        assertFailsWith<ApiError> { inside(work, "/etc/passwd") }
    }

    private fun md5(s: String) = java.security.MessageDigest.getInstance("MD5").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
}
