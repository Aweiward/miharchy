package miharchy.core

import eu.kanade.tachiyomi.data.backup.models.Backup
import eu.kanade.tachiyomi.data.backup.models.BackupCategory
import eu.kanade.tachiyomi.data.backup.models.BackupChapter
import eu.kanade.tachiyomi.data.backup.models.BackupManga
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import miharchy.sync.encodeBackup
import java.nio.file.Files
import java.nio.file.Path
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlin.io.path.createDirectories
import kotlin.io.path.writeBytes
import kotlin.io.path.writeText
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * A v1.1.1 Suwayomi as the move reads it: its GraphQL answers by what a query asks for, behind ui_login. [settings],
 * [metas], [categories] and [mangas] are its replies' JSON; the backup is [backup].
 */
private class FakeSuwayomi(val backup: ByteArray, val settings: String, val metas: String, val categories: String, val mangas: String, val downloads: String) : AutoCloseable {
    val queries = mutableListOf<String>()
    val variables = mutableListOf<JsonObject>()
    private val site = Site { ex ->
        if (ex.requestMethod == "GET") return@Site if (ex.getRequestHeader("Authorization") == "Bearer t0k3n" && ex.requestURI.path == "/api/graphql/files/backup/b.tachibk") backup else null
        val body = Json.parseToJsonElement(ex.requestBody.readAllBytes().decodeToString()).jsonObject
        val query = body["query"]!!.jsonPrimitive.content
        synchronized(queries) { queries += query; variables += (body["variables"] as? JsonObject ?: JsonObject(emptyMap())) }
        val data = when {
            "login(" in query -> """{"login":{"accessToken":"t0k3n"}}"""
            ex.getRequestHeader("Authorization") != "Bearer t0k3n" -> return@Site """{"errors":[{"message":"x : Unauthorized"}]}""".toByteArray()
            "settings {" in query -> """{"settings":$settings}"""
            "extensions(" in query -> """{"extensions":{"nodes":[{"pkgName":"$PKG"}]}}"""
            "createBackup" in query -> """{"createBackup":{"url":"/api/graphql/files/backup/b.tachibk"}}"""
            "metas {" in query -> """{"metas":{"nodes":$metas},"categories":{"nodes":$categories},"mangas":{"nodes":$mangas}}"""
            "isDownloaded" in query -> """{"chapters":{"nodes":$downloads}}"""
            else -> error("unexpected query $query")
        }
        """{"data":$data}""".toByteArray()
    }
    val url = site.url
    override fun close() = site.close()
}

private fun com.sun.net.httpserver.HttpExchange.getRequestHeader(name: String): String? = requestHeaders.getFirst(name)

private const val PKG = "eu.kanade.tachiyomi.extension.en.fixturedownloads"

class MoveTest {
    private val work = Files.createTempDirectory("move")
    private val png = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 9, 9)

    @AfterTest fun clean() {
        work.toFile().walkTopDown().forEach { it.setReadable(true) }
        work.toFile().deleteRecursively()
    }

    private fun dump(db: Database) = runBlocking {
        db.run { c ->
            listOf("manga", "chapter", "category", "manga_category", "history", "metas", "extension_store").associateWith { t ->
                // The move's own report changes with each run.
                c.query("SELECT * FROM $t") { r -> (1..r.metaData.columnCount).joinToString("|") { r.getString(it) ?: "null" } }.filterNot { "miharchy.moveReport" in it }.sorted()
            }
        }
    }

    @Test
    fun aMoveCarriesTheLibraryMetasSettingsAndDownloadsAndRunsAgainToTheSameResult() = runBlocking {
        Site { ex -> if (ex.requestURI.path.endsWith(".png")) png else null }.use { pages ->
            DownloadSite.base = pages.url
            TestRepo(work, PKG).use { repo ->
                val (ks, key) = repo.keystore("move")
                repo.publish(key, 1, repo.jar(listOf(FixtureDownloads::class.java), ks))
                // The source id the backup names: the fixture's, as core's host derives it.
                val sid = run {
                    val probe = Database(work.resolve("probe.db"))
                    val ext = Extensions(probe, TestHost.host, work.resolve("probe-ext"))
                    ext.routes.call("extensionRepo.add", buildJsonObject { put("url", repo.base) })
                    ext.routes.call("extension.install", buildJsonObject { put("pkgName", PKG) })
                    ext.sources().single()["id"]!!.jsonPrimitive.content.toLong().also { probe.close() }
                }
                // Suwayomi's ids differ from core's: its "Action" is 7, core gives it 1.
                val backup = encodeBackup(Backup(
                    backupManga = listOf(BackupManga(
                        source = sid, url = "/m/1", title = "Manga: 1/2", favorite = true, categories = listOf(0),
                        chapters = listOf(
                            BackupChapter(url = "/c/ok", name = "Chapter 1", read = true, sourceOrder = 3),
                            BackupChapter(url = "/c/empty", name = "Chapter 2", lastPageRead = 4, sourceOrder = 2),
                            BackupChapter(url = "/c/html", name = "Chapter 3", sourceOrder = 1),
                        ),
                    )),
                    backupCategories = listOf(BackupCategory("Action", order = 0)),
                ))
                val root = work.resolve("suwayomi")
                val mangaDir = root.resolve("downloads/mangas/Fixture Downloads (EN)/Manga_ 1_2")
                // Chapter 1 as a folder of pages, Chapter 2 as a .cbz, both with Suwayomi's ComicInfo.xml; Chapter 3 a folder core cannot read.
                mangaDir.resolve("Chapter 1").createDirectories().also { d ->
                    d.resolve("002.png").writeBytes(png); d.resolve("001.png").writeBytes(png); d.resolve("ComicInfo.xml").writeText("<ComicInfo/>")
                }
                mangaDir.resolve("Chapter 3").createDirectories().also { it.toFile().setReadable(false) }
                ZipOutputStream(Files.newOutputStream(mangaDir.resolve("Chapter 2.cbz"))).use { z ->
                    listOf("001.png", "ComicInfo.xml").forEach { z.putNextEntry(ZipEntry(it)); z.write(png); z.closeEntry() }
                }
                val settings = """{"extensionRepos":["${repo.base}"],"downloadsPath":"","globalUpdateInterval":24.0,"backupTTL":5,"excludeCompleted":false,"backupTime":"21:30"}"""
                val metas = """[{"key":"miharchy.defaultCategory","value":"7"},{"key":"miharchy.syncFolder","value":"/phone"},{"key":"miharchy.lastAutoBackup","value":"5"}]"""
                val categories = """[{"id":0,"name":"Default","includeInUpdate":"UNSET","includeInDownload":"UNSET","meta":[]},
                    {"id":7,"name":"Action","includeInUpdate":"EXCLUDE","includeInDownload":"INCLUDE","meta":[{"key":"miharchy.keepDownloads","value":"true"}]},
                    {"id":9,"name":"Gone","includeInUpdate":"UNSET","includeInDownload":"UNSET","meta":[]}]"""
                val mangas = """[{"sourceId":"$sid","url":"/m/1","chaptersLastFetchedAt":"1700000000","meta":[{"key":"miharchy.readingMode","value":"webtoon"}]},
                    {"sourceId":"$sid","url":"/m/gone","meta":[{"key":"miharchy.readingMode","value":"paged-ltr"}]}]"""
                fun download(url: String, name: String) = """{"url":"$url","name":"$name","scanlator":null,"manga":{"sourceId":"$sid","url":"/m/1","title":"Manga: 1/2","source":{"displayName":"Fixture Downloads (EN)"}}}"""
                val downloads = "[${download("/c/ok", "Chapter 1")},${download("/c/empty", "Chapter 2")},${download("/c/html", "Chapter 3")}]"
                FakeSuwayomi(backup, settings, metas, categories, mangas, downloads).use { suwayomi ->
                    val config = work.resolve("server.json").also { it.writeText("""{"url":"${suwayomi.url}","username":"u","password":"p"}""") }
                    val helper = work.resolve("helper-sync").createDirectories().also { it.resolve("phone-baseline.tachibk").writeText("phone") }
                    val data = work.resolve("core")
                    data.resolve("sync").createDirectories().resolve("desktop-baseline.tachibk").writeText("core's own")
                    Database(data.resolve("core.db")).use { db ->
                        runBlocking { db.run { c -> c.update("INSERT INTO metas VALUES ('global', 0, 'miharchy.lastAutoBackup', '99')") } }
                        val extensions = Extensions(db, TestHost.host, data.resolve("extensions"))
                        val browse = Browse(db, TestHost.host, extensions, data.resolve("covers"), data.resolve("downloads"))
                        val downloadsSlice = Downloads(db, browse, extensions, data.resolve("downloads"))
                        val sync = Sync(db, data.resolve("sync"), "http://127.0.0.1:4591", setOf(1, 2))
                        val others = extensions.routes + sync.routes + Settings(db, data.resolve("covers")).routes + browse.routes + Library(db, extensions).routes
                        Move(db, downloadsSlice, data, data.resolve("sync")) { r, b -> others.getValue(r)(b) }.use { move ->
                            val start = buildJsonObject {
                                put("serverConfig", config.toString()); put("serverRoot", root.toString()); put("helperSync", helper.toString())
                            }
                            suspend fun moved(): JsonObject {
                                move.routes.call("move.start", start)
                                return withTimeout(30_000) {
                                    var s: JsonObject
                                    do { delay(50); s = move.routes.call("move.status") } while (s["state"]!!.jsonPrimitive.content == "running")
                                    s
                                }
                            }
                            val first = moved()
                            assertEquals("done", first["state"]!!.jsonPrimitive.content, first.toString())
                            val report = first["report"]!!.jsonObject
                            assertEquals(1, report["manga"]!!.jsonPrimitive.content.toInt())
                            assertEquals(2, report["downloads"]!!.jsonPrimitive.content.toInt())
                            val skipped = report["skipped"]!!.jsonArray.map { it.jsonPrimitive.content }
                            assertEquals(4, skipped.size, skipped.toString())
                            assertTrue(skipped.any { it.startsWith("Category Gone:") })
                            assertTrue(skipped.any { it.startsWith("Setting backupTTL:") })
                            assertTrue(skipped.any { it.startsWith("1 manga metas") })
                            // An unreadable folder skips its chapter only; the move goes on.
                            assertTrue(skipped.any { it.startsWith("Download Manga: 1/2 Chapter 3:") })

                            // Ids made core's, core's own meta kept, the float interval taken as whole hours.
                            fun meta(scope: String, owner: Long, key: String) = runBlocking {
                                db.run { c -> c.query("SELECT value FROM metas WHERE scope = ? AND owner = ? AND key = ?", scope, owner, key) { it.getString(1) }.singleOrNull() }
                            }
                            val action = runBlocking { db.run { c -> c.query("SELECT id, include_in_update, include_in_download FROM category WHERE name = 'Action'") { listOf(it.getLong(1), it.getString(2), it.getString(3)) }.single() } }
                            assertEquals(listOf(1L, "EXCLUDE", "INCLUDE"), action)
                            assertEquals("1", meta("global", 0, "miharchy.defaultCategory"))
                            assertEquals("/phone", meta("global", 0, "miharchy.syncFolder"))
                            assertEquals("99", meta("global", 0, "miharchy.lastAutoBackup"))
                            assertEquals("true", meta("category", 1, "miharchy.keepDownloads"))
                            val manga = runBlocking { db.run { c -> c.query("SELECT id FROM manga WHERE remote_url = '/m/1'") { it.getLong(1) }.single() } }
                            assertEquals("webtoon", meta("manga", manga, "miharchy.readingMode"))
                            // The last chapter fetch, which no backup carries, for the library check (#394).
                            assertEquals(1_700_000_000_000L, runBlocking { db.run { c -> c.query("SELECT state_chapter_last_update FROM manga WHERE id = ?", manga) { it.getLong(1) }.single() } })
                            assertEquals("24", meta("global", 0, "miharchy.globalUpdateInterval"))
                            assertEquals("21:30", meta("global", 0, "miharchy.backupTime"))
                            assertEquals("false", meta("global", 0, "miharchy.excludeCompleted"))
                            assertEquals(null, meta("global", 0, "miharchy.backupTTL"))

                            // The pages read from the copies, without ComicInfo.xml; Suwayomi keeps its files.
                            val chapters = browse.routes.call("chapter.list", buildJsonObject { put("mangaIds", kotlinx.serialization.json.JsonArray(listOf(kotlinx.serialization.json.JsonPrimitive(manga)))) })["chapters"]!!.jsonArray.map { it.jsonObject }
                            fun chapter(url: String) = chapters.single { it["url"]!!.jsonPrimitive.content == url }
                            assertEquals(true, chapter("/c/ok")["isRead"]!!.jsonPrimitive.content.toBoolean())
                            assertEquals(4, chapter("/c/empty")["lastPageRead"]!!.jsonPrimitive.content.toInt())
                            for ((url, n) in listOf("/c/ok" to 2, "/c/empty" to 1)) {
                                val id = chapter(url)["id"]!!.jsonPrimitive.long
                                assertEquals(n, browse.routes.call("chapter.pages", buildJsonObject { put("id", id) })["pages"]!!.jsonArray.size, url)
                            }
                            assertTrue(Files.exists(mangaDir.resolve("Chapter 2.cbz")) && Files.exists(mangaDir.resolve("Chapter 1/001.png")))

                            // The helper's baseline where core had none; core's own stays.
                            assertEquals(listOf("phone-baseline.tachibk"), report["baselines"]!!.jsonArray.map { it.jsonPrimitive.content })
                            assertEquals("phone", Files.readString(data.resolve("sync/phone-baseline.tachibk")))
                            assertEquals("core's own", Files.readString(data.resolve("sync/desktop-baseline.tachibk")))
                            // Every part of the library, whatever Suwayomi's backup rows say, and never its server settings.
                            val flags = suwayomi.variables[suwayomi.queries.indexOfFirst { "createBackup" in it }]["flags"]!!.jsonObject
                            assertEquals(
                                mapOf("includeManga" to true, "includeCategories" to true, "includeChapters" to true, "includeTracking" to true,
                                    "includeHistory" to true, "includeClientData" to false, "includeServerSettings" to false),
                                flags.mapValues { it.value.jsonPrimitive.content.toBoolean() },
                            )

                            val before = dump(db)
                            val again = moved()
                            assertEquals("done", again["state"]!!.jsonPrimitive.content, again.toString())
                            assertEquals(0, again["report"]!!.jsonObject["downloads"]!!.jsonPrimitive.content.toInt())
                            assertEquals(before, dump(db))
                        }
                        // After a restart, move.status still says done, with the last report.
                        Move(db, downloadsSlice, data, data.resolve("sync")) { _, _ -> error("no call") }.use { restarted ->
                            val s = restarted.routes.call("move.status")
                            assertEquals("done", s["state"]!!.jsonPrimitive.content, s.toString())
                            assertEquals(0, s["report"]!!.jsonObject["downloads"]!!.jsonPrimitive.content.toInt())
                        }
                    }
                }
            }
        }
    }

    @Test
    fun aMoveNeedsExplicitPathsAndReportsAnUnreachableSuwayomi() = runBlocking {
        Database(work.resolve("core.db")).use { db ->
            val extensions = Extensions(db, TestHost.host, work.resolve("extensions"))
            val browse = Browse(db, TestHost.host, extensions, work.resolve("covers"), work.resolve("downloads"))
            Move(db, Downloads(db, browse, extensions, work.resolve("downloads")), work, work.resolve("sync")) { _, _ -> error("no call") }.use { move ->
                val refused = runCatching { move.routes.call("move.start", buildJsonObject { put("serverRoot", "/x") }) }.exceptionOrNull()
                assertTrue(refused is ApiError && refused.kind == Kind.invalid)
                // A port nothing listens on.
                val config = work.resolve("server.json").also { it.writeText("""{"url":"http://127.0.0.1:9","username":"u","password":"p"}""") }
                move.routes.call("move.start", buildJsonObject { put("serverConfig", config.toString()); put("serverRoot", work.toString()) })
                val s = withTimeout(30_000) {
                    var s: JsonObject
                    do { delay(50); s = move.routes.call("move.status") } while (s["state"]!!.jsonPrimitive.content == "running")
                    s
                }
                assertEquals("failed", s["state"]!!.jsonPrimitive.content)
                assertEquals("network", s["error"]!!.jsonObject["kind"]!!.jsonPrimitive.content)
            }
        }
    }

}
