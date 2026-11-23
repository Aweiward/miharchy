package miharchy.core

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.PosixFilePermissions
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.io.path.name
import kotlin.io.path.writeText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class DownloadsMoveTest {
    private val work = Files.createTempDirectory("downloads-move")
    private val png = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 7, 7)

    private fun ids(vararg ids: Long) = buildJsonObject { put("ids", JsonArray(ids.map(::JsonPrimitive))) }
    private fun set(vararg pairs: Pair<String, Any>) = buildJsonObject {
        put("settings", buildJsonObject { for ((k, v) in pairs) if (v is Boolean) put(k, v) else put(k, v.toString()) })
    }
    private fun md5(s: String) = java.security.MessageDigest.getInstance("MD5").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
    private fun files(dir: Path) = if (!Files.exists(dir)) emptyList() else Files.walk(dir).use { s -> s.filter { Files.isRegularFile(it) }.map { it.name }.sorted().toList() }

    @Test
    fun aNewFolderMovesTheDownloadsAndAFailedMoveChangesNothing() = runBlocking {
        val requests = mutableListOf<String>()
        val hold = AtomicReference<CountDownLatch?>(null)
        Site { ex ->
            synchronized(requests) { requests += ex.requestURI.path }
            when (ex.requestURI.path) {
                "/p0.png" -> png
                "/p1.png" -> png.also { hold.get()?.await(20, TimeUnit.SECONDS) }
                else -> null
            }
        }.use { site ->
            DownloadSite.base = site.url
            TestRepo(work, "eu.kanade.tachiyomi.extension.en.fixturedownloads").use { repo ->
                val (ks, key) = repo.keystore("downloads-move")
                repo.publish(key, 1, repo.jar(listOf(FixtureDownloads::class.java), ks))
                Database(work.resolve("core.db")).use { db ->
                    val extensions = Extensions(db, TestHost.host, work.resolve("extensions"))
                    extensions.routes.call("extensionRepo.add", buildJsonObject { put("url", repo.base) })
                    extensions.routes.call("extension.install", buildJsonObject { put("pkgName", repo.pkg) })
                    val root = work.resolve("downloads")
                    val folder = DownloadsFolder(root)
                    val browse = Browse(db, TestHost.host, extensions, work.resolve("covers"), folder)
                    val downloads = Downloads(db, browse, extensions, folder)
                    val r = browse.routes + downloads.routes + Settings(db, work.resolve("covers"), folder, moveDownloads = downloads::moveTo).routes
                    val sid = r.call("source.list")["sources"]!!.jsonArray.last().jsonObject["id"]!!.jsonPrimitive.content
                    val mangaId = r.call("source.popular", buildJsonObject { put("source", sid); put("page", 1) })["mangas"]!!.jsonArray.single().jsonObject["id"]!!.jsonPrimitive.long
                    val chapters = r.call("manga.refresh", buildJsonObject { put("id", mangaId) })["chapters"]!!.jsonArray.map { it.jsonObject }
                    fun chapter(url: String) = chapters.single { it["url"]!!.jsonPrimitive.content == url }["id"]!!.jsonPrimitive.long
                    val (ok, twin) = listOf("/c/ok", "/c/twin").map(::chapter)
                    val twinName = "Chapter 1_" + md5("/c/twin").take(6) + ".cbz"
                    val mangaDir = "Fixture Downloads (EN)/Manga_ 1_2"

                    suspend fun idle() = withTimeout(30_000) {
                        downloads.status.first { s -> s is JsonObject && s["state"]!!.jsonPrimitive.content == "STOPPED" && s["queue"]!!.jsonArray.none { it.jsonObject["state"]!!.jsonPrimitive.content != "ERROR" } }
                    }
                    /** The move to [to] once it has ended: its state, `done` or `failed`. */
                    suspend fun ended(to: Path) = withTimeout(30_000) {
                        downloads.status.first { s -> (s as? JsonObject)?.get("move")?.jsonObject?.let { it["to"]!!.jsonPrimitive.content == to.toString() && it["state"]!!.jsonPrimitive.content != "moving" } == true }
                    }.jsonObject["move"]!!.jsonObject
                    suspend fun stored() = r.call("settings.get")["settings"]!!.jsonObject["downloadsPath"]!!.jsonPrimitive.content
                    suspend fun page(chapter: Long) = browse.images.getValue("page")(listOf(chapter.toString(), "1")).bytes

                    r.call("download.enqueue", ids(ok))
                    idle()
                    assertEquals(listOf("Chapter 1.cbz"), files(root))
                    assertEquals(null, downloads.routes.call("download.queue")["move"]?.takeIf { it !is kotlinx.serialization.json.JsonNull }, "no move has run")

                    // Refused: not empty, around the old folder, inside it. A refusal stores no key of its request.
                    val full = Files.createDirectories(work.resolve("full")).also { Files.writeString(it.resolve("mine.txt"), "x") }
                    for (to in listOf(full, work, root.resolve("inner"))) {
                        r.expect(Kind.invalid, "settings.set", set("downloadsPath" to to, "excludeCompleted" to false))
                    }
                    assertEquals("true", r.call("settings.get")["settings"]!!.jsonObject["excludeCompleted"].toString())
                    assertEquals("", stored())
                    assertEquals(listOf("Chapter 1.cbz"), files(root))

                    // A failed move changes nothing: no setting, no folder, no copy.
                    suspend fun fails(to: Path) {
                        r.call("settings.set", set("downloadsPath" to to))
                        val move = ended(to)
                        assertEquals("failed", move["state"]!!.jsonPrimitive.content, to.toString())
                        assertTrue(move["error"]!!.jsonPrimitive.content.isNotEmpty())
                        assertEquals("", stored())
                        assertEquals(root, folder.path)
                        assertEquals(listOf("Chapter 1.cbz"), files(root).filter { it == "Chapter 1.cbz" })
                        assertEquals(emptyList(), files(to), "no copy is left")
                        assertTrue(!Files.exists(work.resolve("failed")), "no folder this move made is left")
                        assertTrue(page(ok).contentEquals(png))
                    }
                    // A target whose parent is a file.
                    fails(work.resolve("afile").also { Files.writeString(it, "x") }.resolve("sub"))
                    // A second chapter the copy cannot read: files copy in path order, so the first is copied and then undone.
                    r.call("download.enqueue", ids(twin)); idle()
                    val unreadable = root.resolve(mangaDir).resolve(twinName)
                    Files.setPosixFilePermissions(unreadable, PosixFilePermissions.fromString("---------"))
                    // Root reads anything, so there the move would not fail.
                    if (!Files.isReadable(unreadable)) fails(work.resolve("failed/new"))
                    Files.setPosixFilePermissions(unreadable, PosixFilePermissions.fromString("rw-------"))
                    Files.delete(unreadable)
                    r.call("download.delete", ids(twin))

                    // A move with the queue running: it stops, the files copy, and it starts again into the new folder.
                    val target = work.resolve("moved/new")
                    val latch = CountDownLatch(1).also(hold::set)
                    r.call("download.enqueue", ids(twin))
                    withTimeout(20_000) { downloads.status.first { s -> s is JsonObject && s["queue"]!!.jsonArray.any { it.jsonObject["progress"]!!.jsonPrimitive.double == 0.5 } } }
                    val asked = System.currentTimeMillis()
                    val reply = r.call("settings.set", set("downloadsPath" to target, "excludeCompleted" to false))
                    latch.countDown()
                    hold.set(null)
                    assertEquals("", reply["settings"]!!.jsonObject["downloadsPath"]!!.jsonPrimitive.content, "settings.get answers the old text until the move ends")
                    assertEquals("false", reply["settings"]!!.jsonObject["excludeCompleted"].toString(), "the other keys are stored at once")
                    val done = ended(target)
                    assertEquals(listOf("done", 1, 1), listOf(done["state"]!!.jsonPrimitive.content, done["done"]!!.jsonPrimitive.content.toInt(), done["total"]!!.jsonPrimitive.content.toInt()))
                    assertEquals(listOf(root.toString(), target.toString()), listOf(done["from"]!!.jsonPrimitive.content, done["to"]!!.jsonPrimitive.content))
                    assertTrue(done["startedAt"]!!.jsonPrimitive.long >= asked, "startedAt is the move's own time")
                    assertEquals(target.toString(), stored())
                    assertEquals(target, folder.path)
                    idle()
                    assertEquals(listOf("Chapter 1.cbz", twinName), files(target.resolve(mangaDir)).sorted())
                    assertEquals(emptyList(), files(root), "the old files are gone")
                    assertTrue(Files.isDirectory(root), "the default folder stays")
                    assertEquals(emptyList(), Files.list(root).use { it.toList() }, "and so do none of its empty sub-folders")
                    // The reader opens a moved chapter with no network.
                    val before = synchronized(requests) { requests.size }
                    assertEquals(2, r.call("chapter.pages", buildJsonObject { put("id", ok) })["pages"]!!.jsonArray.size)
                    assertTrue(page(ok).contentEquals(png))
                    assertEquals(before, synchronized(requests) { requests.size })
                    assertEquals("STOPPED", r.call("download.queue")["state"]!!.jsonPrimitive.content)

                    // The same folder again is a plain store, and storage.get measures the new folder.
                    r.call("settings.set", set("downloadsPath" to target))
                    assertEquals(target.toString(), stored())
                    assertEquals(Files.walk(target).use { s -> s.filter { Files.isRegularFile(it) }.mapToLong { Files.size(it) }.sum() }, r.call("storage.get")["downloads"]!!.jsonPrimitive.long)

                    // Blank goes back to the default folder. Only core's .cbz files move: a file of the user's stays, with its folder.
                    target.resolve("notes.txt").writeText("mine")
                    r.call("settings.set", set("downloadsPath" to ""))
                    assertEquals("done", ended(root)["state"]!!.jsonPrimitive.content)
                    assertEquals(listOf("Chapter 1.cbz", twinName), files(root).sorted())
                    assertEquals(listOf("notes.txt"), files(target), "the user's file stays where it was")
                    Files.delete(target.resolve("notes.txt"))
                    assertEquals("", stored())
                    assertTrue(page(ok).contentEquals(png))
                }
            }
        }
    }

    @Test
    fun aFolderTheUserSetIsReadAtStart() = runBlocking {
        Database(work.resolve("core.db")).use { db ->
            val set = work.resolve("elsewhere")
            db.run { c -> storeSettings(c, mapOf("downloadsPath" to set.toString())) }
            assertEquals(set, DownloadsFolder(work.resolve("downloads"), db.run { c -> setting(c, "downloadsPath").content }).path)
            assertEquals(work.resolve("downloads"), DownloadsFolder(work.resolve("downloads")).path)
        }
    }
}
