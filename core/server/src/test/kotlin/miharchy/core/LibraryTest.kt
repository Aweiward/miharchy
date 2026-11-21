package miharchy.core

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class LibraryTest {
    private val work = Files.createTempDirectory("library")
    private val file = work.resolve("core.db")

    private fun library(db: Database) = Library(db, Extensions(db, TestHost.host, work.resolve("extensions"))).routes
    private fun obj(vararg pairs: Pair<String, Any>) = buildJsonObject {
        for ((k, v) in pairs) put(k, json(v))
    }
    private fun json(v: Any): JsonElement = when (v) {
        is JsonElement -> v
        is Boolean -> JsonPrimitive(v)
        is Number -> JsonPrimitive(v)
        is List<*> -> JsonArray(v.map { json(it!!) })
        else -> JsonPrimitive(v.toString())
    }
    private fun JsonObject.ids(k: String) = this[k]!!.jsonArray.map { it.jsonPrimitive.long }
    private fun JsonElement.o() = jsonObject
    private fun JsonObject.l(k: String) = this[k]!!.jsonPrimitive.long

    /** Two manga with [chapters] chapters each, the way a listing and a refresh leave them. */
    private suspend fun seed(db: Database, chapters: Int = 3): List<Long> = db.run { c ->
        (1..2).map { n ->
            val id = c.query("INSERT INTO manga (source_id, remote_url, remote_title, remote_cover) VALUES (7, ?, ?, 'https://x/c.png') RETURNING id", "/m/$n", "Manga $n") { it.getLong(1) }.single()
            c.batch("INSERT INTO chapter (manga_id, remote_url, remote_name, remote_chapter_number, remote_date_upload, remote_order, state_date_fetch) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (0 until chapters).map { i -> listOf(id, "/m/$n/c/$i", "Ch. ${chapters - i}", (chapters - i).toDouble(), 1_690_000_000_000L, i, 1_700_000_100_000L) })
            id
        }
    }

    @Test
    fun theLibraryAndCategoriesSurviveARestart() = runBlocking {
        val (a, b) = Database(file).use { db ->
            val r = library(db)
            val (a, b) = seed(db)
            assertEquals(0, r.call("library.list")["mangas"]!!.jsonArray.size, "listed manga are not in the library")

            val added = r.call("manga.update", obj("ids" to listOf(a, b), "inLibrary" to true))["mangas"]!!.jsonArray
            assertEquals(listOf("true", "true"), added.map { it.o()["inLibrary"].toString() })

            // Categories: names are checked, ids are never reused, and Default stays.
            val drama = r.call("category.create", obj("name" to " Drama "))["category"]!!.o()
            assertEquals("\"Drama\"", drama["name"].toString())
            r.expect(Kind.invalid, "category.create", obj("name" to "drama"))
            r.expect(Kind.invalid, "category.create", obj("name" to "Default"))
            val action = r.call("category.create", obj("name" to "Action"))["category"]!!.o().l("id")
            val temp = r.call("category.create", obj("name" to "Temp"))["category"]!!.o().l("id")
            r.call("meta.set", obj("metas" to listOf(obj("scope" to "category", "owner" to temp, "key" to "miharchy.keepDownloads", "value" to "true"))))
            r.call("category.delete", obj("id" to temp))
            val fresh = r.call("category.create", obj("name" to "Fresh"))["category"]!!.o()
            assertTrue(fresh.l("id") > temp, "a deleted id is not reused")
            assertEquals("[]", fresh["meta"].toString(), "the deleted category's metas went with it")
            r.expect(Kind.invalid, "category.delete", obj("id" to 0))
            r.expect(Kind.invalid, "category.update", obj("id" to 0, "name" to "Mine"))
            r.call("category.update", obj("id" to action, "name" to "Battle", "includeInUpdate" to "EXCLUDE"))
            r.expect(Kind.invalid, "category.update", obj("id" to action, "includeInDownload" to "MAYBE"))
            val order = r.call("category.reorder", obj("id" to fresh.l("id"), "position" to 1))["categories"]!!.jsonArray.map { it.o()["name"]!!.jsonPrimitive.content }
            assertEquals(listOf("Default", "Fresh", "Drama", "Battle"), order)

            r.call("manga.update", obj("ids" to listOf(a), "addToCategories" to listOf(drama.l("id"), action)))
            val moved = r.call("manga.update", obj("ids" to listOf(a), "removeFromCategories" to listOf(action)))["mangas"]!!.jsonArray.single().o()
            assertEquals(listOf(drama.l("id")), moved.ids("categories"))
            r.expect(Kind.notFound, "manga.update", obj("ids" to listOf(a), "addToCategories" to listOf(999)))
            r.call("manga.update", obj("ids" to listOf(b), "inLibrary" to false))
            a to b
        }
        Database(file).use { db ->
            val r = library(db)
            val list = r.call("library.list")
            val manga = list["mangas"]!!.jsonArray.single().o()
            assertEquals(a, manga.l("id"))
            assertEquals(listOf("Default", "Fresh", "Drama", "Battle"), list["categories"]!!.jsonArray.map { it.o()["name"]!!.jsonPrimitive.content })
            assertEquals("\"EXCLUDE\"", list["categories"]!!.jsonArray.single { it.o()["name"].toString() == "\"Battle\"" }.o()["includeInUpdate"].toString())
            assertEquals(listOf(list["categories"]!!.jsonArray.single { it.o()["name"].toString() == "\"Drama\"" }.o().l("id")), manga.ids("categories"))
            assertEquals(3, manga["chapterCount"]!!.jsonPrimitive.content.toInt())
            assertEquals(3, manga["unreadCount"]!!.jsonPrimitive.content.toInt())
            // Suwayomi's units: inLibraryAt and fetchedAt in seconds, uploadDate in milliseconds.
            assertTrue(manga.l("inLibraryAt") in 1_700_000_000L..9_999_999_999L)
            assertEquals("1700000100", manga["latestFetchedChapter"]!!.o()["fetchedAt"].toString())
            assertEquals("1690000000000", manga["latestUploadedChapter"]!!.o()["uploadDate"].toString())
            assertEquals("null", manga["lastReadChapter"].toString())
            assertTrue(b !in list["mangas"]!!.jsonArray.map { it.o().l("id") })
        }
    }

    @Test
    fun readingProgressFeedsHistory() = runBlocking {
        Database(file).use { db ->
            val r = library(db)
            val (a, b) = seed(db)
            val chapters = r.call("chapter.update", obj("ids" to listOf(1, 2, 3), "isRead" to true))["chapters"]!!.jsonArray
            assertEquals(listOf("true", "true", "true"), chapters.map { it.o()["isRead"].toString() })
            assertEquals(0, r.call("history.list")["chapters"]!!.jsonArray.size, "marking read is not reading")

            r.call("chapter.update", obj("ids" to listOf(2), "lastPageRead" to 5))
            Thread.sleep(5)
            val saved = r.call("chapter.update", obj("ids" to listOf(4), "lastPageRead" to 2, "isBookmarked" to true))["chapters"]!!.jsonArray.single().o()
            assertEquals("true", saved["isBookmarked"].toString())
            assertTrue(saved.l("lastReadAt") > 1_700_000_000L, "lastReadAt is in seconds")
            r.expect(Kind.notFound, "chapter.update", obj("ids" to listOf(999), "isRead" to true))
            r.expect(Kind.invalid, "chapter.update", obj("ids" to listOf(1), "lastPageRead" to -1))

            val history = r.call("history.list")
            val rows = history["chapters"]!!.jsonArray.map { it.o() }
            assertEquals(listOf(4L, 2L), rows.map { it.l("id") }, "the newest read first")
            assertEquals(b, rows[0]["manga"]!!.o().l("id"))
            assertEquals("false", rows[0]["manga"]!!.o()["inLibrary"].toString(), "History keeps manga outside the library")
            assertEquals(listOf(2L), r.call("history.list", obj("readOnly" to true))["chapters"]!!.jsonArray.map { it.o().l("id") })
            val first = r.call("history.list", obj("limit" to 1))
            assertEquals("true", first["hasNextPage"].toString())
            assertEquals(listOf(2L), r.call("history.list", obj("limit" to 1, "offset" to 1))["chapters"]!!.jsonArray.map { it.o().l("id") })

            // Metas: global, manga and category, set in one call, read by key and owner, deleted for many manga.
            r.call("meta.set", obj("metas" to listOf(
                obj("scope" to "global", "key" to "miharchy.historyClearedAt", "value" to "1700000000"),
                obj("scope" to "manga", "owner" to a, "key" to "miharchy.notes", "value" to "good"),
                obj("scope" to "manga", "owner" to b, "key" to "miharchy.notes", "value" to "bad"),
            )))
            r.expect(Kind.notFound, "meta.set", obj("metas" to listOf(obj("scope" to "manga", "owner" to 999, "key" to "k", "value" to "v"))))
            assertEquals("\"1700000000\"", r.call("meta.get", obj("scope" to "global", "keys" to listOf("miharchy.historyClearedAt")))["metas"]!!.jsonArray.single().o()["value"].toString())
            assertEquals(2, r.call("meta.get", obj("scope" to "manga", "keys" to listOf("miharchy.notes")))["metas"]!!.jsonArray.size)
            assertEquals("2", r.call("meta.delete", obj("scope" to "manga", "owners" to listOf(a, b), "keys" to listOf("miharchy.notes")))["deleted"].toString())
            r.expect(Kind.invalid, "meta.get", obj("scope" to "chapter"))
        }
    }
}
