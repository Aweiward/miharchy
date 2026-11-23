package miharchy.core

import kotlinx.coroutines.flow.first
import miharchy.sync.decodeBackup
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.FileTime
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlin.io.path.createDirectories
import kotlin.io.path.exists
import kotlin.io.path.readBytes
import kotlin.io.path.writeBytes
import kotlin.io.path.writeText
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The local source (#374) through Browse's routes, over a temp folder. */
class LocalTest {
    private val work = Files.createTempDirectory("local")
    private val root = work.resolve("local").createDirectories()
    private fun png(n: Int) = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, n.toByte())
    private fun jpg(n: Int) = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), n.toByte())

    private fun zip(file: Path, vararg entries: Pair<String, ByteArray>) {
        file.parent.createDirectories()
        ZipOutputStream(Files.newOutputStream(file)).use { z -> for ((n, b) in entries) { z.putNextEntry(ZipEntry(n)); z.write(b); z.closeEntry() } }
    }

    private fun comicInfo(vararg fields: Pair<String, String>) = "<ComicInfo xmlns:ty=\"http://www.w3.org/2001/XMLSchema\">${fields.joinToString("") { (k, v) -> "<$k>$v</$k>" }}</ComicInfo>"

    /** Alpha: ComicInfo, cover.jpg, a folder chapter and a .cbz. Bravo: details.json. charlie: a broken ComicInfo. */
    private fun fill() {
        root.resolve("Alpha").createDirectories().also { a ->
            a.resolve("ComicInfo.xml").writeText(comicInfo("Series" to "Alpha Title", "Writer" to "W", "Penciller" to "P", "Summary" to "S", "Genre" to "Action, Drama", "ty:PublishingStatusTachiyomi" to "Ongoing"))
            a.resolve("cover.jpg").writeBytes(jpg(1))
            a.resolve("Chapter 1").createDirectories().also { c -> listOf(2, 10, 1).forEach { c.resolve("$it.png").writeBytes(png(it)) } }
            zip(a.resolve("Chapter 2.cbz"), "001.png" to png(21), "ComicInfo.xml" to comicInfo("Title" to "Second", "Number" to "2").toByteArray())
        }
        root.resolve("Bravo").createDirectories().also { b ->
            b.resolve("details.json").writeText("""{"title":"Bravo J","author":"A","artist":"B","description":"D","genre":["x","y"],"status":2}""")
            zip(b.resolve("Ch 5.cbz"), "1.png" to png(51))
        }
        root.resolve("charlie").createDirectories().also { c ->
            c.resolve("ComicInfo.xml").writeText("<ComicInfo><Series>")
            c.resolve("Chapter 1").createDirectories().resolve("1.png").writeBytes(png(31))
        }
    }

    private fun body(vararg pairs: Pair<String, Any>) = buildJsonObject {
        put("source", LOCAL_SOURCE)
        for ((k, v) in pairs) when (v) { is Long -> put(k, v); is Int -> put(k, v); else -> put(k, v.toString()) }
    }

    private fun JsonObject.titles() = this["mangas"]!!.jsonArray.map { it.jsonObject["title"]!!.jsonPrimitive.content }
    private fun JsonObject.ids() = this["mangas"]!!.jsonArray.map { it.jsonObject["id"]!!.jsonPrimitive.long }

    private fun <T> withCore(block: suspend (Database, Browse) -> T): T = runBlocking {
        Database(work.resolve("core.db")).use { db ->
            block(db, Browse(db, TestHost.host, Extensions(db, TestHost.host, work.resolve("extensions")), work.resolve("covers"), work.resolve("downloads"), Local { root }))
        }
    }

    @Test
    fun theSourceListShowsTheLocalSourceFirst() = withCore { _, browse ->
        val first = browse.routes.call("source.list")["sources"]!!.jsonArray.first().jsonObject
        assertEquals("0", first["id"]!!.jsonPrimitive.content)
        assertEquals("Local source", first["displayName"]!!.jsonPrimitive.content)
        assertEquals("other", first["lang"]!!.jsonPrimitive.content)
    }

    @Test
    fun aListingSortsByTitleOrByNewestFolderAndSearchesTheFolderName() = withCore { _, browse ->
        fill()
        root.resolve("Alpha").let { Files.setLastModifiedTime(it, FileTime.fromMillis(3_000_000)) }
        root.resolve("charlie").let { Files.setLastModifiedTime(it, FileTime.fromMillis(9_000_000)) }
        root.resolve("Bravo").let { Files.setLastModifiedTime(it, FileTime.fromMillis(5_000_000)) }
        root.resolve(".hidden").createDirectories()
        root.resolve("a file").writeText("x")
        val r = browse.routes
        val popular = r.call("source.popular", body("page" to 1))
        assertEquals(listOf("Alpha", "Bravo", "charlie"), popular.titles())
        assertEquals("false", popular["hasNextPage"].toString())
        assertEquals(listOf("charlie", "Bravo", "Alpha"), r.call("source.latest", body("page" to 1)).titles())
        assertEquals(listOf("Bravo"), r.call("source.search", body("query" to "RAV")).titles())
        assertEquals(emptyList(), r.call("source.popular", body("page" to 2)).titles())
        assertEquals(JsonArray(emptyList()), r.call("source.filters", body())["filters"])
        // The cover shows from cover.jpg, and from the first page of the oldest chapter without one.
        val covers = popular["mangas"]!!.jsonArray.map { it.jsonObject["thumbnailUrl"]!!.jsonPrimitive.content }
        assertTrue(covers.all { it.startsWith("/api/cover/") })
        // A missing folder is an empty listing, not an error.
        val none = Local { work.resolve("none") }.handle(body("op" to "popular", "page" to 1))
        assertEquals(0, none.jsonObject["mangas"]!!.jsonArray.size)
    }

    @Test
    fun aRefreshReadsTheDetailsAndOrdersTheChaptersNewestFirst() = withCore { db, browse ->
        fill()
        val ids = browse.routes.call("source.popular", body("page" to 1)).ids()
        suspend fun refresh(id: Long) = browse.routes.call("manga.refresh", buildJsonObject { put("id", id) })
        val alpha = refresh(ids[0])
        val m = alpha["manga"]!!.jsonObject
        assertEquals(listOf("Alpha Title", "W", "P", "S", "ONGOING"), listOf("title", "author", "artist", "description", "status").map { m[it]!!.jsonPrimitive.content })
        assertEquals(listOf("Action", "Drama"), m["genre"]!!.jsonArray.map { it.jsonPrimitive.content })
        val chapters = alpha["chapters"]!!.jsonArray.map { it.jsonObject }
        // The .cbz's own ComicInfo names and numbers it; the folder's number comes from its name.
        assertEquals(listOf("Second", "Chapter 1"), chapters.map { it["name"]!!.jsonPrimitive.content })
        assertEquals(listOf(2.0, 1.0), chapters.map { it["chapterNumber"]!!.jsonPrimitive.content.toDouble() })
        assertEquals(listOf("Alpha/Chapter 2.cbz", "Alpha/Chapter 1"), chapters.map { it["url"]!!.jsonPrimitive.content })
        assertEquals(listOf(2, 1), chapters.map { it["sourceOrder"]!!.jsonPrimitive.int })
        assertEquals(Files.getLastModifiedTime(root.resolve("Alpha/Chapter 2.cbz")).toMillis(), chapters[0]["uploadDate"]!!.jsonPrimitive.long)

        val bravo = refresh(ids[1])["manga"]!!.jsonObject
        assertEquals(listOf("Bravo J", "A", "B", "D", "COMPLETED"), listOf("title", "author", "artist", "description", "status").map { bravo[it]!!.jsonPrimitive.content })
        assertEquals(listOf("x", "y"), bravo["genre"]!!.jsonArray.map { it.jsonPrimitive.content })
        // A broken ComicInfo.xml degrades to the folder name.
        assertEquals("charlie", refresh(ids[2])["manga"]!!.jsonObject["title"]!!.jsonPrimitive.content)
        // The order is the number, newest first; equal numbers fall back to the name in natural order.
        for (n in listOf("Ch 5.5", "Ch 12", "Ch 6 a", "Ch 6 b")) zip(root.resolve("Bravo/$n.cbz"), "1.png" to png(1))
        val numbered = refresh(ids[1])["chapters"]!!.jsonArray.map { it.jsonObject["name"]!!.jsonPrimitive.content to it.jsonObject["chapterNumber"]!!.jsonPrimitive.content.toDouble() }
        assertEquals(numbered.map { it.second }.sortedDescending(), numbered.map { it.second })
        assertEquals("Ch 12", numbered.first().first)
        assertEquals(5, db.run { c -> c.query("SELECT count(*) FROM chapter WHERE manga_id = ?", ids[1]) { it.getInt(1) }.single() })
    }

    @Test
    fun aBrokenArchiveNeverFailsAListing() = withCore { _, browse ->
        root.resolve("Torn").createDirectories().resolve("Ch 1.cbz").writeText("not a zip")
        root.resolve("Fine").createDirectories().resolve("Chapter 1").createDirectories().resolve("1.png").writeBytes(png(1))
        val listed = browse.routes.call("source.popular", body("page" to 1))
        assertEquals(listOf("Fine", "Torn"), listed.titles())
        val torn = browse.routes.call("manga.refresh", buildJsonObject { put("id", listed.ids()[1]) })
        assertEquals("Ch 1", torn["chapters"]!!.jsonArray.single().jsonObject["name"]!!.jsonPrimitive.content)
    }

    @Test
    fun aComicInfoWithAnEntityIsNeverReadAndNeverFailsTheListing() = withCore { _, browse ->
        val secret = work.resolve("secret.txt").also { it.writeText("TOP-SECRET") }
        root.resolve("Xxe").createDirectories().also { d ->
            d.resolve("ComicInfo.xml").writeText("""<?xml version="1.0"?><!DOCTYPE x [<!ENTITY xxe SYSTEM "${secret.toUri()}">]><ComicInfo><Series>&xxe;</Series><Summary>&xxe;</Summary></ComicInfo>""")
            zip(d.resolve("Ch 1.cbz"), "1.png" to png(1), "ComicInfo.xml" to """<!DOCTYPE x [<!ENTITY xxe SYSTEM "${secret.toUri()}">]><ComicInfo><Title>&xxe;</Title></ComicInfo>""".toByteArray())
        }
        val listed = browse.routes.call("source.popular", body("page" to 1))
        assertEquals(listOf("Xxe"), listed.titles())
        val refreshed = browse.routes.call("manga.refresh", buildJsonObject { put("id", listed.ids().single()) })
        assertFalse(refreshed.toString().contains("TOP-SECRET"))
        assertEquals("Xxe", refreshed["manga"]!!.jsonObject["title"]!!.jsonPrimitive.content)
        assertEquals("Ch 1", refreshed["chapters"]!!.jsonArray.single().jsonObject["name"]!!.jsonPrimitive.content)
    }

    @Test
    fun pagesAndCoversComeFromTheFilesAndLeaveThemInPlace() = withCore { _, browse ->
        fill()
        val ids = browse.routes.call("source.popular", body("page" to 1)).ids()
        val chapters = browse.routes.call("manga.refresh", buildJsonObject { put("id", ids[0]) })["chapters"]!!.jsonArray.map { it.jsonObject }
        val folder = chapters.single { it["url"]!!.jsonPrimitive.content == "Alpha/Chapter 1" }["id"]!!.jsonPrimitive.long
        val archive = chapters.single { it["url"]!!.jsonPrimitive.content == "Alpha/Chapter 2.cbz" }["id"]!!.jsonPrimitive.long
        val page = browse.images.getValue("page")
        // Natural order: 1, 2, 10 (a plain sort puts 10 before 2).
        val read = browse.routes.call("chapter.pages", buildJsonObject { put("id", folder) })
        assertEquals(listOf("/api/page/$folder/0", "/api/page/$folder/1", "/api/page/$folder/2"), read["pages"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertContentEquals(png(1), page(listOf("$folder", "0")).bytes)
        assertContentEquals(png(2), page(listOf("$folder", "1")).bytes)
        assertContentEquals(png(10), page(listOf("$folder", "2")).bytes)
        assertEquals("image/png", page(listOf("$archive", "0")).contentType)
        assertContentEquals(png(21), page(listOf("$archive", "0")).bytes)
        browse.routes.expect(Kind.notFound, "chapter.pages", buildJsonObject { put("id", 999) })
        // The cover is cover.jpg; without one, the first page of the oldest chapter.
        val cover = browse.images.getValue("cover")
        assertContentEquals(jpg(1), cover(listOf("${ids[0]}")).bytes)
        assertContentEquals(png(51), cover(listOf("${ids[1]}")).bytes)
        assertContentEquals(png(31), cover(listOf("${ids[2]}")).bytes)
        // The user's files are all still there, and the cover is cached in core's folder.
        assertTrue(root.resolve("Alpha/cover.jpg").exists() && root.resolve("Alpha/Chapter 1/2.png").exists() && root.resolve("Alpha/Chapter 2.cbz").exists())
        assertContentEquals(jpg(1), root.resolve("Alpha/cover.jpg").readBytes())
        assertEquals(3, Files.list(work.resolve("covers")).use { it.count() })
        // A changed cover is a new url, so it is read again.
        root.resolve("Alpha/cover.jpg").writeBytes(jpg(7))
        Files.setLastModifiedTime(root.resolve("Alpha/cover.jpg"), FileTime.fromMillis(42_000))
        browse.routes.call("manga.refresh", buildJsonObject { put("id", ids[0]) })
        assertContentEquals(jpg(7), cover(listOf("${ids[0]}")).bytes)
    }

    @Test
    fun aMissingFolderFailsTheRefreshAndKeepsTheChaptersAndReadState() = withCore { db, browse ->
        fill()
        val id = browse.routes.call("source.popular", body("page" to 1)).ids()[0]
        val chapter = browse.routes.call("manga.refresh", buildJsonObject { put("id", id) })["chapters"]!!.jsonArray.first().jsonObject["id"]!!.jsonPrimitive.long
        db.run { c -> c.update("UPDATE chapter SET user_read = 1, user_last_page_read = 3 WHERE id = ?", chapter) }
        root.resolve("Alpha").toFile().deleteRecursively()
        try {
            browse.routes.call("manga.refresh", buildJsonObject { put("id", id) })
            kotlin.test.fail("the folder is gone")
        } catch (e: ApiError) {
            assertEquals(Kind.notFound, e.kind)
            assertEquals("The folder Alpha is not in the local manga folder $root.", e.message)
        }
        val kept = db.run { c -> c.query("SELECT user_read, user_last_page_read FROM chapter WHERE id = ?", chapter) { listOf(it.getInt(1), it.getInt(2)) }.single() }
        assertEquals(listOf(1, 3), kept)
        assertEquals(2, db.run { c -> c.query("SELECT count(*) FROM chapter WHERE manga_id = ?", id) { it.getInt(1) }.single() })
    }

    @Test
    fun aUrlThatLeavesTheLocalFolderIsRefused() = withCore { db, browse ->
        fill()
        work.resolve("secret.png").writeBytes(png(99))
        root.resolve("Alpha/..x").createDirectories()
        val (manga, chapter) = db.run { c ->
            val m = c.query("INSERT INTO manga (source_id, remote_url, remote_title, remote_cover) VALUES (0, '../local', 't', '../secret.png?1') RETURNING id") { it.getLong(1) }.single()
            val ok = c.query("INSERT INTO manga (source_id, remote_url, remote_title) VALUES (0, 'Alpha', 'Alpha') RETURNING id") { it.getLong(1) }.single()
            val ch = listOf("../secret.png", "Alpha/../../secret.png", "Alpha/Chapter 1/../../../x").map { u ->
                c.query("INSERT INTO chapter (manga_id, remote_url, remote_name, remote_chapter_number, remote_order, state_date_fetch) VALUES (?, ?, 'c', 1, 0, 0) RETURNING id", ok, u) { it.getLong(1) }.single()
            }
            m to ch
        }
        browse.routes.expect(Kind.invalid, "manga.refresh", buildJsonObject { put("id", manga) })
        chapter.forEach { browse.routes.expect(Kind.invalid, "chapter.pages", buildJsonObject { put("id", it) }) }
        try { browse.images.getValue("cover")(listOf("$manga")); kotlin.test.fail("outside the folder") } catch (e: ApiError) { assertEquals(Kind.invalid, e.kind) }
        assertEquals(1, Files.list(work).use { s -> s.filter { it.fileName.toString() == "secret.png" }.count() }.toInt())
    }

    @Test
    fun noChapterOfALocalMangaIsEverDownloadedOrAutoDownloaded() = withCore { db, browse ->
        fill()
        val id = browse.routes.call("source.popular", body("page" to 1)).ids()[0]
        val first = browse.routes.call("manga.refresh", buildJsonObject { put("id", id) })["chapters"]!!.jsonArray.map { it.jsonObject["id"]!!.jsonPrimitive.long }
        val downloads = Downloads(db, browse, Extensions(db, TestHost.host, work.resolve("extensions")), work.resolve("downloads"))
        val status = downloads.routes.call("download.enqueue", buildJsonObject { put("ids", JsonArray(first.map(::JsonPrimitive))) })
        assertEquals(0, status["queue"]!!.jsonArray.size)

        // With the setting on and the manga in the library, a refresh that adds a chapter queues nothing.
        val queued = mutableListOf<Long>()
        browse.autoDownload = { queued += it }
        db.run { c ->
            c.update("INSERT INTO metas (scope, owner, key, value) VALUES ('global', 0, 'miharchy.autoDownloadNewChapters', 'true'), ('global', 0, 'miharchy.excludeEntryWithUnreadChapters', 'false')")
            c.update("UPDATE manga SET user_favorite_at = 1 WHERE id = ?", id)
        }
        zip(root.resolve("Alpha/Chapter 3.cbz"), "1.png" to png(1))
        val after = browse.routes.call("manga.refresh", buildJsonObject { put("id", id) })["chapters"]!!.jsonArray.map { it.jsonObject["id"]!!.jsonPrimitive.long }
        assertEquals(3, after.size)
        assertEquals(emptyList(), queued)
        // The same rows from another source would queue the new chapter: the skip is the source's.
        db.run { c ->
            c.update("UPDATE manga SET source_id = 7 WHERE id = ?", id)
            assertEquals(listOf(after[0]), autoDownloads(c, id, listOf(after[0]), 0.0))
            c.update("UPDATE manga SET source_id = 0 WHERE id = ?", id)
            assertEquals(emptyList(), autoDownloads(c, id, listOf(after[0]), 0.0))
        }
    }

    @Test
    fun aLibraryUpdateSkipsALocalMangaWhoseFolderIsGone() = withCore { db, _ ->
        root.resolve("Here").createDirectories()
        db.run { c ->
            for (name in listOf("Here", "Gone")) {
                val id = c.query("INSERT INTO manga (source_id, remote_url, remote_title, user_favorite_at, state_initialized) VALUES (0, ?, ?, 1, 1) RETURNING id", name, name) { it.getLong(1) }.single()
                c.update("INSERT INTO chapter (manga_id, remote_url, remote_name, remote_chapter_number, remote_order, state_date_fetch, user_read) VALUES (?, ?, 'c', 1, 0, 0, 1)", id, "$name/c")
            }
        }
        val refreshed = java.util.Collections.synchronizedList(mutableListOf<Long>())
        Updates(db, { refreshed += it }, tick = 3_600_000, local = Local { root }).use { u ->
            val started = u.routes.call("update.start")
            assertEquals(1, started["totalJobs"]!!.jsonPrimitive.int)
            assertEquals(1, started["skippedMangasCount"]!!.jsonPrimitive.int)
            val done = withTimeout(10_000) { u.status.first { it is JsonObject && it["isRunning"]!!.jsonPrimitive.content == "false" }.jsonObject }
            assertEquals(0, done["failed"]!!.jsonArray.size)
            assertEquals(1, refreshed.size)
        }
    }

    @Test
    fun naturalOrderKeepsCoresZeroPaddedNamesInPlace() {
        val names = listOf("010.jpg", "002.png", "001.jpg", "100.jpg")
        assertEquals(names.sorted(), names.sortedWith(NATURAL))
        assertEquals(listOf("1.jpg", "2.jpg", "10.jpg", "a1.jpg", "B2.jpg"), listOf("10.jpg", "B2.jpg", "2.jpg", "1.jpg", "a1.jpg").sortedWith(NATURAL))
    }

    @Test
    fun aBackupCarriesLocalMangaAsMihonDoesAndAPhoneCoverStringFallsBackToTheFolder() = withCore { db, browse ->
        fill()
        val alpha = browse.routes.call("source.popular", body("page" to 1)).ids().first()
        browse.routes.call("manga.refresh", buildJsonObject { put("id", alpha) })
        db.run { c -> c.update("UPDATE manga SET user_favorite_at = 1 WHERE id = ?", alpha) }
        val out = Files.createDirectories(work.resolve("backups"))
        val file = Sync(db, work.resolve("sync"), "http://127.0.0.1", emptySet()).routes.call("backup.export", buildJsonObject { put("folder", out.toString()) })
            .getValue("file").jsonPrimitive.content
        val m = decodeBackup(Path.of(file).readBytes()).backupManga.single()
        assertEquals(0L, m.source)
        assertEquals("Alpha", m.url)
        assertEquals(listOf("Alpha/Chapter 1", "Alpha/Chapter 2.cbz"), m.chapters.map { it.url }.sorted())
        assertEquals(null, m.thumbnailUrl, "core's cover path means nothing on the phone")
        // A cover string synced from the phone is no path here: the folder's own cover shows instead.
        db.run { c -> c.update("UPDATE manga SET remote_cover = 'content://phone/Alpha/cover.jpg' WHERE id = ?", alpha) }
        assertContentEquals(jpg(1), browse.images.getValue("cover")(listOf("$alpha")).bytes)
    }

    @Test
    fun comicInfoFillsFieldsAsMihonsCopyFromComicInfo() = withCore { _, browse ->
        root.resolve("Delta").createDirectories().also { d ->
            d.resolve("ComicInfo.xml").writeText(comicInfo("Series" to "Delta", "Penciller" to "P1, P2", "Inker" to "P2, I", "Genre" to "Action", "Tags" to "Action, Tag"))
            zip(d.resolve("b.cbz"), "1.png" to png(1), "ComicInfo.xml" to comicInfo("Title" to "Bee", "Translator" to "Team", "Year" to "2021", "Month" to "3").toByteArray())
            zip(d.resolve("a.cbz"), "1.png" to png(2))
            zip(d.resolve("Chapter 10.cbz"), "1.png" to png(3))
        }
        val id = browse.routes.call("source.popular", body("page" to 1)).ids().single()
        val r = browse.routes.call("manga.refresh", buildJsonObject { put("id", id) })
        val m = r["manga"]!!.jsonObject
        assertEquals("P1, P2, I", m["artist"]!!.jsonPrimitive.content)
        assertEquals(listOf("Action", "Tag"), m["genre"]!!.jsonArray.map { it.jsonPrimitive.content })
        val chapters = r["chapters"]!!.jsonArray.map { it.jsonObject }
        // Mihon's local order: the name in natural order, descending.
        assertEquals(listOf("Chapter 10", "Bee", "a"), chapters.map { it["name"]!!.jsonPrimitive.content })
        val bee = chapters[1]
        assertEquals("Team", bee["scanlator"]!!.jsonPrimitive.content)
        val date = java.time.Instant.ofEpochMilli(bee["uploadDate"]!!.jsonPrimitive.long).atZone(java.time.ZoneId.systemDefault()).toLocalDate()
        assertEquals(java.time.LocalDate.of(2021, 3, 1), date)
    }

    @Test
    fun aMacZipsMetadataFilesAreNoPages() = withCore { _, browse ->
        zip(root.resolve("Echo/Vol 1.cbz"), "__MACOSX/pages/._1.png" to byteArrayOf(0, 5, 22), "pages/1.png" to png(1), "pages/.2.png" to png(9), "pages/2.png" to png(2))
        root.resolve("Echo/Ch 2").createDirectories().also { it.resolve("._1.png").writeBytes(byteArrayOf(0)); it.resolve("1.png").writeBytes(png(3)) }
        val id = browse.routes.call("source.popular", body("page" to 1)).ids().single()
        val chapters = browse.routes.call("manga.refresh", buildJsonObject { put("id", id) })["chapters"]!!.jsonArray.map { it.jsonObject["id"]!!.jsonPrimitive.long }
        assertEquals(listOf(2, 1), chapters.map { browse.routes.call("chapter.pages", buildJsonObject { put("id", it) })["pages"]!!.jsonArray.size })
    }
}
