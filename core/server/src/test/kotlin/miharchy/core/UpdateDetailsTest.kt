package miharchy.core

import eu.kanade.tachiyomi.source.model.FilterList
import eu.kanade.tachiyomi.source.model.MangasPage
import eu.kanade.tachiyomi.source.model.Page
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.SManga
import eu.kanade.tachiyomi.source.model.SMangaUpdate
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
import java.nio.file.Files
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.Test
import kotlin.test.assertEquals

/** What each `update` asked for, and the details the source answers with: always new ones, so a kept title shows core dropped them. */
object DetailsSite {
    val asked = CopyOnWriteArrayList<Boolean>()
}

class FixtureDetails : HttpSource() {
    override val name = "Fixture Details"
    override val lang = "en"
    override val supportsLatest = false
    override val baseUrl = "http://127.0.0.1:1"

    override suspend fun getPopularManga(page: Int) = MangasPage(listOf(SManga.create().apply { url = "/m/1"; title = "Listed"; thumbnail_url = "$baseUrl/old.png" }), false)
    override suspend fun getLatestUpdates(page: Int) = getPopularManga(page)
    override suspend fun getSearchManga(page: Int, query: String, filters: FilterList) = getPopularManga(page)
    override suspend fun getMangaUpdate(manga: SManga, chapters: List<SChapter>, needsDetails: Boolean, needsChapters: Boolean): SMangaUpdate {
        DetailsSite.asked += needsDetails
        val details = SManga.create().apply { url = manga.url; title = "Fetched"; author = "Fetched author"; thumbnail_url = "$baseUrl/new.png"; initialized = true }
        return SMangaUpdate(details, listOf(SChapter.create().apply { url = "/c/1"; name = "Chapter 1" }))
    }
    override suspend fun getPageList(chapter: SChapter) = emptyList<Page>()
    override fun getMangaUrl(manga: SManga) = baseUrl + manga.url
    override fun getChapterUrl(chapter: SChapter) = baseUrl + chapter.url
}

class UpdateDetailsTest {
    private val work = Files.createTempDirectory("details")

    @Test
    fun aLibraryUpdateFetchesDetailsForAMangaThatLacksThemOrWhenUpdateMangasIsOn() = runBlocking {
        TestRepo(work, "eu.kanade.tachiyomi.extension.en.fixturedetails").use { repo ->
            val (ks, key) = repo.keystore("details")
            repo.publish(key, 1, repo.jar(listOf(FixtureDetails::class.java), ks))
            Database(work.resolve("core.db")).use { db ->
                val extensions = Extensions(db, TestHost.host, work.resolve("extensions"))
                extensions.routes.call("extensionRepo.add", buildJsonObject { put("url", repo.base) })
                extensions.routes.call("extension.install", buildJsonObject { put("pkgName", repo.pkg) })
                val browse = Browse(db, TestHost.host, extensions, work.resolve("covers"), work.resolve("downloads"))
                val sid = browse.routes.call("source.list")["sources"]!!.jsonArray.last().jsonObject["id"]!!.jsonPrimitive.content
                val id = browse.routes.call("source.popular", buildJsonObject { put("source", sid); put("page", 1) })["mangas"]!!.jsonArray.single().jsonObject["id"]!!.jsonPrimitive.long
                Library(db, extensions).routes.call("manga.update", buildJsonObject { put("ids", JsonArray(listOf(JsonPrimitive(id)))); put("inLibrary", true) })
                val settings = Settings(db, work.resolve("covers")).routes
                // The skip filters would leave this manga out of every run.
                settings.call("settings.set", buildJsonObject { put("settings", buildJsonObject { put("excludeUnreadChapters", false); put("excludeNotStarted", false) }) })
                suspend fun title() = browse.routes.call("manga.get", buildJsonObject { put("id", id) })["manga"]!!.jsonObject["title"]!!.jsonPrimitive.content
                suspend fun cover() = db.run { c -> c.query("SELECT remote_cover FROM manga WHERE id = ?", id) { it.getString(1) }.single() }
                suspend fun run() = Updates(db, { m, details -> browse.refresh(m, details) }, tick = 3_600_000).use { u ->
                    u.routes.call("update.start")
                    withTimeout(30_000) { u.status.first { it is JsonObject && it["isRunning"]!!.jsonPrimitive.content == "false" && it["finishedJobs"]!!.jsonPrimitive.content == "1" } }
                }
                suspend fun asked(block: suspend () -> Unit): List<Boolean> { DetailsSite.asked.clear(); block(); return DetailsSite.asked.toList() }

                // Never initialized: the first update fetches the details, as Mihon's does.
                assertEquals(listOf(true), asked { run() })
                assertEquals("Fetched", title())
                db.run { c -> c.update("UPDATE manga SET remote_title = 'Stored' WHERE id = ?", id) }
                val stored = cover()

                // Initialized, with a cover, the switch off: chapters only, and the stored details stay.
                assertEquals(listOf(false), asked { run() })
                assertEquals("Stored", title())
                assertEquals(stored, cover())
                assertEquals(1, browse.routes.call("chapter.list", buildJsonObject { put("mangaIds", JsonArray(listOf(JsonPrimitive(id)))) })["chapters"]!!.jsonArray.size)

                // A manual refresh always fetches them.
                assertEquals(listOf(true), asked { browse.routes.call("manga.refresh", buildJsonObject { put("id", id) }) })
                assertEquals("Fetched", title())

                // The switch on: details with the chapters.
                db.run { c -> c.update("UPDATE manga SET remote_title = 'Stored' WHERE id = ?", id) }
                settings.call("settings.set", buildJsonObject { put("settings", buildJsonObject { put("updateMangas", true) }) })
                assertEquals(listOf(true), asked { run() })
                assertEquals("Fetched", title())

                // No cover is a reason too, with the switch off.
                settings.call("settings.set", buildJsonObject { put("settings", buildJsonObject { put("updateMangas", false) }) })
                db.run { c -> c.update("UPDATE manga SET remote_cover = NULL WHERE id = ?", id) }
                assertEquals(listOf(true), asked { run() })
            }
        }
    }
}
