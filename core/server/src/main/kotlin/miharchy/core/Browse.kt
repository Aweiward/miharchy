package miharchy.core

import eu.kanade.tachiyomi.network.CloudflareChallengeException
import eu.kanade.tachiyomi.network.HttpException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import tachiyomi.domain.chapter.service.ChapterRecognition
import yomi.host.Host
import yomi.host.WebViewUnavailableException
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.sql.Connection
import java.sql.ResultSet

/** An image route's reply. */
class Image(val bytes: ByteArray, val contentType: String)

/** An image route: the path segments after `/api/<kind>/` in, the image out. */
typealias ImageRoute = suspend (List<String>) -> Image

/**
 * One call into the host, with its errors mapped to ADR 0010's kinds. A source that blocks
 * (a WebView latch, a stuck socket) times out; ponytail: its thread is abandoned, not stopped.
 */
suspend fun Host.call(req: JsonObject, seconds: Long = 120): JsonElement {
    val job = CoroutineScope(Dispatchers.IO).async { handle(req) }
    try {
        return withTimeout(seconds * 1000) { job.await() }
    } catch (e: TimeoutCancellationException) {
        job.cancel()
        throw ApiError(Kind.network, "The source did not answer within $seconds s.")
    } catch (e: CancellationException) {
        // The caller stopped (a download or update stop): not a source failure.
        job.cancel()
        throw e
    } catch (e: ApiError) {
        throw e
    } catch (e: Exception) {
        val chain = generateSequence<Throwable>(e) { it.cause }.toList()
        chain.firstNotNullOfOrNull { it as? WebViewUnavailableException }?.let { throw ApiError(Kind.webview, it.message.orEmpty()) }
        chain.firstNotNullOfOrNull { it as? CloudflareChallengeException }?.let {
            throw ApiError(Kind.cloudflare, "${it.url} shows a Cloudflare challenge.")
        }
        if (e is IllegalArgumentException && e.message.orEmpty().startsWith("unknown source")) {
            throw ApiError(Kind.notFound, "The source ${req["source"]?.jsonPrimitive?.content} is not installed.")
        }
        if (e is IllegalArgumentException && e.message.orEmpty().startsWith("no setting")) throw ApiError(Kind.invalid, e.message.orEmpty())
        chain.firstNotNullOfOrNull { it as? HttpException }?.let { throw ApiError(Kind.network, "The site answered HTTP ${it.code}.") }
        if (e is IOException) throw ApiError(Kind.network, "${e::class.java.simpleName}: ${e.message}")
        throw ApiError(Kind.source, "${e::class.java.simpleName}: ${e.message}")
    }
}


/**
 * Browsing and reading on the source side (#365): source listings, manga details and chapter lists
 * in Mihon's tables, chapter pages, and covers and page images fetched through the source's client.
 */
/** [downloads]: the downloads folder, whose .cbz files the reader reads with no network (#367). */
class Browse(
    private val db: Database, private val host: Host, private val extensions: Extensions, private val covers: Path, private val downloads: Path,
    private val local: Local = Local { downloads.resolveSibling("local") },
) {
    /** Gets the chapters each refresh queues for auto-download (#424). Main sets it to the download queue. */
    var autoDownload: suspend (List<Long>) -> Unit = {}

    private val pages = object : LinkedHashMap<Long, List<JsonObject>>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Long, List<JsonObject>>) = size > 50
    }

    init { ownerOnlyDir(covers) }

    val routes: Map<String, Route> = mapOf(
        "source.list" to { _ -> buildJsonObject { put("sources", JsonArray(extensions.sources())) } },
        "source.popular" to { input -> listing(input, "popular") },
        "source.latest" to { input -> listing(input, "latest") },
        "source.search" to { input -> listing(input, "search") },
        "source.filters" to { input -> buildJsonObject { put("filters", call(op("filters", input.source()))) } },
        "source.settings" to { input -> buildJsonObject { put("settings", call(op("settings", input.source()))) } },
        "source.setSetting" to { input ->
            val accepted = call(buildJsonObject { put("op", "setSetting"); put("source", input.source()); put("key", input.text("key")); put("value", input["value"] ?: JsonNull) })
            buildJsonObject { put("accepted", accepted); put("settings", call(op("settings", input.source()))) }
        },
        "manga.get" to { input -> buildJsonObject { put("manga", detail(input.id("id"))) } },
        "manga.refresh" to { input -> refresh(input.id("id")) },
        // By manga (mangaIds) or by chapter (ids), as Downloads.autoDeleteQuery asks. unread and since (upload time in ms)
        // narrow it, so the bar mark's poll reads only the recent unread chapters (#386).
        "chapter.list" to { input ->
            val (key, col) = if ("ids" in input) "ids" to "ch.id" else "mangaIds" to "ch.manga_id"
            val ids = (input[key] as? JsonArray)?.map { it.jsonPrimitive.longOrNull ?: throw ApiError(Kind.invalid, "$key holds numbers.") }
                ?: throw ApiError(Kind.invalid, "The request needs mangaIds or ids, a list of ids.")
            val unread = input["unread"]?.let { (it as? JsonPrimitive)?.booleanOrNull ?: throw ApiError(Kind.invalid, "unread is true or false.") } ?: false
            val since = input["since"]?.let { (it as? JsonPrimitive)?.longOrNull ?: throw ApiError(Kind.invalid, "since is a time in ms.") }
            val where = among(col) + (if (unread) " AND ch.user_read = 0" else "") + (if (since != null) " AND ch.remote_date_upload > ?" else "")
            val args = listOfNotNull<Any>(idList(ids), since).toTypedArray()
            buildJsonObject { put("chapters", JsonArray(db.run { c -> chapterRows(c, where, *args) })) }
        },
        "chapter.pages" to { input -> chapterPages(input.id("id")) },
    )

    val images: Map<String, ImageRoute> = mapOf(
        "cover" to { path -> cover(path.singleOrNull()?.toLongOrNull() ?: throw ApiError(Kind.notFound, "No such cover.")) },
        "page" to { path ->
            val chapter = path.getOrNull(0)?.toLongOrNull()
            val index = path.getOrNull(1)?.toIntOrNull()
            if (chapter == null || index == null || path.size != 2) throw ApiError(Kind.notFound, "No such page.")
            page(chapter, index)
        },
    )

    /** Source 0 is the local folder (#374); the host has no such source. Its images never go through `download`, which deletes the file it returns. */
    private suspend fun call(req: JsonObject, seconds: Long = 120): JsonElement =
        if (req["source"]?.jsonPrimitive?.content == LOCAL_SOURCE) local.handle(req) else host.call(req, seconds)

    private suspend fun listing(input: JsonObject, op: String): JsonObject {
        val source = input.source()
        val page = (input["page"] as? JsonPrimitive)?.intOrNull ?: 1
        val reply = call(buildJsonObject {
            put("op", op); put("source", source); put("page", page)
            if (op == "search") {
                put("query", (input["query"] as? JsonPrimitive)?.contentOrNull ?: "")
                (input["filters"] as? JsonArray)?.let { put("filters", it) }
            }
        }).jsonObject
        val found = reply["mangas"]!!.jsonArray.map { it.jsonObject }.filter { it.s("url") != null }
        val mangas = db.run { c -> c.transaction { found.map { upsertListed(c, source.toLong(), it) } } }
        return buildJsonObject { put("hasNextPage", reply["hasNextPage"]!!); put("mangas", JsonArray(mangas)) }
    }

    /** A manga a listing shows. Details the user already loaded stay as they are, as in Mihon. */
    private fun upsertListed(c: Connection, source: Long, m: JsonObject): JsonObject = c.prepareStatement(
        """INSERT INTO manga (source_id, remote_url, remote_title, remote_cover) VALUES (?, ?, ?, ?)
           ON CONFLICT (source_id, remote_url) DO UPDATE SET
             remote_title = CASE WHEN state_initialized = 0 THEN excluded.remote_title ELSE remote_title END,
             remote_cover = CASE WHEN state_initialized = 0 THEN coalesce(excluded.remote_cover, remote_cover) ELSE remote_cover END
           RETURNING id, remote_title, remote_cover, user_favorite_at""",
    ).use { p ->
        p.setLong(1, source); p.setString(2, m.s("url")); p.setString(3, m.s("title") ?: ""); p.setString(4, m.s("thumbnailUrl"))
        p.executeQuery().use { r ->
            r.next()
            buildJsonObject {
                put("id", r.getLong(1)); put("title", r.getString(2))
                put("thumbnailUrl", if (r.getString(3) != null) "/api/cover/${r.getLong(1)}" else null)
                put("inLibrary", r.getObject(4) != null)
            }
        }
    }

    private class Row(val id: Long, val source: Long, val fields: JsonObject)

    private fun row(c: Connection, id: Long): Row = c.prepareStatement(
        """SELECT id, source_id, remote_url, remote_title, remote_author, remote_artist, remote_description, remote_genre,
                  remote_status, remote_cover, remote_update_strategy, remote_memo, user_favorite_at, state_initialized
           FROM manga WHERE id = ?""",
    ).use { p ->
        p.setLong(1, id)
        p.executeQuery().use { r ->
            if (!r.next()) throw ApiError(Kind.notFound, "There is no manga $id.")
            Row(r.getLong(1), r.getLong(2), buildJsonObject {
                put("url", r.getString(3)); put("title", r.getString(4)); put("author", r.getString(5)); put("artist", r.getString(6))
                put("description", r.getString(7)); put("genre", r.getString(8)); put("status", r.getInt(9)); put("thumbnailUrl", r.getString(10))
                put("updateStrategy", if (r.getInt(11) == 1) "ONLY_FETCH_ONCE" else "ALWAYS_UPDATE")
                put("memo", Json.parseToJsonElement(r.getString(12))); put("favoriteAt", r.getObject(13)?.let { r.getLong(13) })
                put("initialized", r.getInt(14) == 1)
            })
        }
    }

    /** The host's own manga fields, as `update` takes them. */
    private fun hostManga(row: Row) = JsonObject(row.fields.filterKeys { it != "favoriteAt" })

    private suspend fun detail(id: Long): JsonObject {
        val (row, chapters, extra) = db.run { c -> Triple(row(c, id), chapters(c, id), mangaCategories(c, listOf(id))[id]!! to mangaMetas(c, listOf(id))[id]!!) }
        return mangaJson(row, chapters, extra.first, extra.second)
    }

    /** The fields `Browse.toManga` reads today. */
    private suspend fun mangaJson(row: Row, chapters: List<JsonObject>, categories: JsonArray, meta: JsonArray): JsonObject {
        val f = row.fields
        val source = extensions.sources().firstOrNull { it["id"]!!.jsonPrimitive.content == row.source.toString() }
        val urls = source?.let {
            runCatching {
                call(buildJsonObject {
                    put("op", "urls"); put("source", row.source.toString()); put("manga", hostManga(row))
                    put("chapters", JsonArray(chapters.map { ch -> buildJsonObject { put("url", ch["url"]!!); put("name", ch["name"]!!) } }))
                }, seconds = 10).jsonObject
            }.getOrNull()
        }
        val chapterUrls = urls?.get("chapters")?.jsonArray
        return buildJsonObject {
            put("id", row.id)
            put("sourceId", row.source.toString())
            put("source", source?.let { s -> buildJsonObject { put("displayName", s["displayName"]!!) } } ?: JsonNull)
            put("url", f["url"]!!)
            put("realUrl", urls?.get("manga") ?: JsonNull)
            put("title", f["title"]!!)
            put("author", f["author"]!!); put("artist", f["artist"]!!); put("description", f["description"]!!)
            put("genre", genres(f.s("genre")))
            put("status", status(f["status"]!!.jsonPrimitive.intOrNull ?: 0))
            put("thumbnailUrl", if (f.s("thumbnailUrl") != null) "/api/cover/${row.id}" else null)
            put("inLibrary", f["favoriteAt"] !is JsonNull)
            put("initialized", f["initialized"]!!)
            put("inLibraryAt", seconds(f["favoriteAt"]?.jsonPrimitive?.longOrNull))
            put("categories", categories)
            put("meta", meta)
            put("chapters", JsonArray(chapters.mapIndexed { i, ch ->
                val realUrl = chapterUrls?.getOrNull(i)
                if (realUrl == null) ch else JsonObject(ch + ("realUrl" to realUrl))
            }))
        }
    }

    private fun chapters(c: Connection, mangaId: Long) = chapterRows(c, "ch.manga_id = ?", mangaId)

    /**
     * Fetches details and chapters, as `fetchMangaAndChapters` does. Read state survives: chapters match by URL. With [details]
     * false (a library update, Mihon's `updateMangas` rule) the details the source sends back are dropped, whatever they hold.
     * The local source reads the disk anyway, so it always takes them.
     */
    internal suspend fun refresh(id: Long, details: Boolean = true): JsonObject {
        val (row, known) = db.run { c -> row(c, id) to hostChapters(c, id) }
        val fetched = details || row.source.toString() == LOCAL_SOURCE
        val reply = call(buildJsonObject {
            put("op", "update"); put("source", row.source.toString()); put("manga", hostManga(row))
            put("chapters", JsonArray(known))
            put("needsDetails", fetched); put("needsChapters", true)
        }).jsonObject
        // An extension may echo the manga it was given, or send back a blank one: either way the stored details stay.
        val m = if (fetched) reply["manga"]!!.jsonObject else hostManga(row)
        val list = reply["chapters"]!!.jsonArray.map { it.jsonObject }.filter { it.s("url") != null }
        // An empty list is a source failure, never a reason to drop the chapters the user has read.
        if (list.isEmpty()) throw ApiError(Kind.source, "The source returned no chapters for ${row.fields.s("title")}.")
        // Many sources leave the number unset; Mihon reads it from the names, with the whole list for context.
        val numbers = ChapterRecognition.parseChapterNumbers(
            m.s("title") ?: row.fields.s("title").orEmpty(),
            list.map { ChapterRecognition.Chapter(it.s("name").orEmpty(), it["chapterNumber"]?.jsonPrimitive?.contentOrNull?.toDoubleOrNull() ?: -1.0) },
        ).map { n -> n.chapter?.let(ChapterRecognition::toDouble) ?: -1.0 }
        val coverChanged = fetched && m.s("thumbnailUrl") != null && m.s("thumbnailUrl") != row.fields.s("thumbnailUrl")
        db.run { c ->
            c.transaction {
                c.prepareStatement(
                    """UPDATE manga SET remote_title = ?, remote_author = ?, remote_artist = ?, remote_description = ?, remote_genre = ?,
                         remote_status = ?, remote_cover = coalesce(?, remote_cover), remote_update_strategy = ?, remote_memo = ?,
                         state_initialized = max(state_initialized, ?), state_chapter_last_update = ? WHERE id = ?""",
                ).use { p ->
                    p.setString(1, m.s("title") ?: row.fields.s("title")); p.setString(2, m.s("author")); p.setString(3, m.s("artist"))
                    p.setString(4, m.s("description")); p.setString(5, m.s("genre")); p.setInt(6, m["status"]?.jsonPrimitive?.intOrNull ?: 0)
                    p.setString(7, m.s("thumbnailUrl")); p.setInt(8, if (m.s("updateStrategy") == "ONLY_FETCH_ONCE") 1 else 0)
                    p.setString(9, (m["memo"] as? JsonObject ?: JsonObject(emptyMap())).toString())
                    p.setInt(10, if (fetched) 1 else 0); p.setLong(11, System.currentTimeMillis()); p.setLong(12, id)
                    p.executeUpdate()
                }
                val now = System.currentTimeMillis()
                c.prepareStatement(
                    """INSERT INTO chapter (manga_id, remote_url, remote_name, remote_scanlator, remote_chapter_number, remote_date_upload,
                         remote_order, remote_memo, state_date_fetch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT (manga_id, remote_url) DO UPDATE SET remote_name = excluded.remote_name,
                         remote_scanlator = excluded.remote_scanlator, remote_chapter_number = excluded.remote_chapter_number,
                         remote_date_upload = CASE WHEN excluded.remote_date_upload = 0 THEN remote_date_upload ELSE excluded.remote_date_upload END,
                         remote_order = excluded.remote_order, remote_memo = excluded.remote_memo""",
                ).use { p ->
                    list.forEachIndexed { i, ch ->
                        p.setLong(1, id); p.setString(2, ch.s("url")); p.setString(3, ch.s("name") ?: ""); p.setString(4, ch.s("scanlator"))
                        p.setDouble(5, numbers[i])
                        p.setLong(6, ch["dateUpload"]?.jsonPrimitive?.longOrNull ?: 0); p.setInt(7, i)
                        p.setString(8, (ch["memo"] as? JsonObject ?: JsonObject(emptyMap())).toString()); p.setLong(9, now)
                        p.addBatch()
                    }
                    p.executeBatch()
                }
                // Chapters the source no longer lists go, as in Mihon.
                val urls = list.map { it.s("url")!! }.toSet()
                val gone = known.mapNotNull { it.s("url") }.filter { it !in urls }
                c.prepareStatement("DELETE FROM chapter WHERE manga_id = ? AND remote_url = ?").use { p -> gone.forEach { p.setLong(1, id); p.setString(2, it); p.addBatch() }; p.executeBatch() }
                val knownUrls = known.mapNotNull { it.s("url") }.toSet()
                val added = c.query("SELECT id, remote_url FROM chapter WHERE manga_id = ?", id) { it.getLong(1) to it.getString(2) }
                    .filter { it.second !in knownUrls }.map { it.first }
                autoDownloads(c, id, added, known.firstOrNull()?.get("chapterNumber")?.jsonPrimitive?.doubleOrNull)
            }
        }.let { queue ->
            // A failed auto-download never fails the refresh that found the chapters.
            if (queue.isNotEmpty()) try { autoDownload(queue) } catch (e: CancellationException) { throw e } catch (e: Exception) {
                System.err.println("miharchy-core: auto-download of $queue failed: $e")
            }
        }
        if (coverChanged) dropCovers(id)
        val fresh = detail(id)
        return buildJsonObject {
            put("manga", JsonObject(fresh - "chapters"))
            put("chapters", fresh["chapters"]!!)
        }
    }

    /** The stored chapters with every field the host's `update` takes, so a source that hands them back keeps them. */
    private fun hostChapters(c: Connection, mangaId: Long): List<JsonObject> = c.prepareStatement(
        "SELECT remote_url, remote_name, remote_chapter_number, remote_scanlator, remote_date_upload, remote_memo FROM chapter WHERE manga_id = ? ORDER BY remote_order",
    ).use { p ->
        p.setLong(1, mangaId)
        p.executeQuery().use { r ->
            generateSequence {
                if (!r.next()) null else buildJsonObject {
                    put("url", r.getString(1)); put("name", r.getString(2)); put("chapterNumber", r.getDouble(3))
                    put("scanlator", r.getString(4)); put("dateUpload", r.getLong(5)); put("memo", Json.parseToJsonElement(r.getString(6)))
                }
            }.toList()
        }
    }

    private suspend fun chapterPages(id: Long): JsonObject {
        val (state, count) = archive(id)?.let { file -> readState(id) to withContext(Dispatchers.IO) { cbzPages(file).size } }
            ?: pageList(id).let { (state, list) -> state to list.size }
        return buildJsonObject {
            put("pages", JsonArray((0 until count).map { JsonPrimitive("/api/page/$id/$it") }))
            put("chapter", state)
        }
    }

    /** The chapter's .cbz when it is downloaded and on disk, else null. */
    private suspend fun archive(id: Long): Path? {
        val rel = db.run { c -> c.query("SELECT download_path FROM chapter WHERE id = ?", id) { it.getString(1) }.firstOrNull() } ?: return null
        val file = inside(downloads, rel)
        return file.takeIf { withContext(Dispatchers.IO) { Files.isRegularFile(it) } }
    }

    private suspend fun readState(id: Long): JsonObject = db.run { c ->
        c.query("SELECT user_read, user_last_page_read FROM chapter WHERE id = ?", id) { r ->
            buildJsonObject { put("id", id); put("isRead", r.getInt(1) == 1); put("lastPageRead", r.getInt(2)) }
        }.firstOrNull() ?: throw ApiError(Kind.notFound, "There is no chapter $id.")
    }

    /** A chapter's read state and its page list, fetched again when it is not cached (for example after a restart). */
    internal suspend fun pageList(id: Long, fresh: Boolean = true): Pair<JsonObject, List<JsonObject>> {
        val (source, chapter, state) = db.run { c ->
            c.prepareStatement(
                """SELECT m.source_id, ch.remote_url, ch.remote_name, ch.remote_chapter_number, ch.remote_scanlator, ch.remote_date_upload,
                          ch.remote_memo, ch.user_read, ch.user_last_page_read
                   FROM chapter ch JOIN manga m ON m.id = ch.manga_id WHERE ch.id = ?""",
            ).use { p ->
                p.setLong(1, id)
                p.executeQuery().use { r ->
                    if (!r.next()) throw ApiError(Kind.notFound, "There is no chapter $id.")
                    Triple(
                        r.getLong(1).toString(),
                        buildJsonObject {
                            put("url", r.getString(2)); put("name", r.getString(3)); put("chapterNumber", r.getDouble(4))
                            put("scanlator", r.getString(5)); put("dateUpload", r.getLong(6)); put("memo", Json.parseToJsonElement(r.getString(7)))
                        },
                        buildJsonObject { put("id", id); put("isRead", r.getInt(8) == 1); put("lastPageRead", r.getInt(9)) },
                    )
                }
            }
        }
        if (!fresh) synchronized(pages) { pages[id] }?.let { return state to it }
        val list = call(buildJsonObject { put("op", "pages"); put("source", source); put("chapter", chapter) }).jsonArray.map { it.jsonObject }
        synchronized(pages) { pages[id] = list }
        // Suwayomi's pageCount, which History and Up next show.
        db.run { c -> c.prepareStatement("UPDATE chapter SET page_count = ? WHERE id = ?").use { it.setInt(1, list.size); it.setLong(2, id); it.executeUpdate() } }
        return state to list
    }

    /** A page from the chapter's .cbz when it is downloaded, else from the source. */
    private suspend fun page(chapter: Long, index: Int): Image {
        archive(chapter)?.let { file ->
            val bytes = withContext(Dispatchers.IO) { cbzPage(file, index) } ?: throw ApiError(Kind.notFound, "Chapter $chapter has no page $index.")
            return Image(bytes, sniff(bytes))
        }
        return fetchPage(chapter, index)
    }

    /** A page from the source, which the downloader writes to the .cbz. */
    internal suspend fun fetchPage(chapter: Long, index: Int): Image {
        val (_, list) = pageList(chapter, fresh = false)
        val page = list.getOrNull(index) ?: throw ApiError(Kind.notFound, "Chapter $chapter has no page $index.")
        val source = db.run { c -> c.prepareStatement("SELECT m.source_id FROM chapter ch JOIN manga m ON m.id = ch.manga_id WHERE ch.id = ?").use { p -> p.setLong(1, chapter); p.executeQuery().use { r -> r.next(); r.getLong(1).toString() } } }
        if (source == LOCAL_SOURCE) {
            val bytes = local.page(page.s("url").orEmpty(), page.s("imageUrl").orEmpty())
            return Image(bytes, sniff(bytes))
        }
        return download(buildJsonObject { put("op", "download"); put("source", source); put("page", page) })
    }

    /** A cover, cached in the data folder under its URL's hash, so a new cover URL fetches again. */
    private suspend fun cover(id: Long): Image {
        val row = db.run { c -> row(c, id) }
        val url = row.fields.s("thumbnailUrl") ?: throw ApiError(Kind.notFound, "Manga $id has no cover.")
        val file = covers.resolve("$id-${sha1(url).take(16)}")
        withContext(Dispatchers.IO) { if (Files.exists(file)) Files.readAllBytes(file) else null }?.let { return Image(it, sniff(it)) }
        val image = if (row.source.toString() == LOCAL_SOURCE) {
            val bytes = try { local.image(url) } catch (e: ApiError) { local.coverOf(row.fields.s("url").orEmpty())?.let { local.image(it) } ?: throw e }
            Image(bytes, sniff(bytes))
        } else download(buildJsonObject { put("op", "download"); put("source", row.source.toString()); put("url", url) })
        // An error page must not stay cached under this cover's URL.
        if (!image.contentType.startsWith("image/")) throw ApiError(Kind.source, "The cover of manga $id is not an image.")
        withContext(Dispatchers.IO) {
            dropCovers(id)
            val part = covers.resolve("$id.part")
            Files.write(part, image.bytes)
            Files.move(part, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        }
        return image
    }

    private fun dropCovers(id: Long) = Files.list(covers).use { s -> s.filter { it.fileName.toString().startsWith("$id-") }.toList() }.forEach(Files::deleteIfExists)

    /** The host writes the image to a temporary file; core reads it and deletes it. */
    private suspend fun download(req: JsonObject): Image {
        val path = host.call(req).jsonPrimitive.content
        return withContext(Dispatchers.IO) {
            val file = File(path)
            try {
                val bytes = file.readBytes()
                Image(bytes, sniff(bytes))
            } finally {
                file.delete()
            }
        }
    }
}

/** The content type, from the first bytes, because the host keeps only the bytes. */
fun sniff(b: ByteArray): String {
    fun at(i: Int, vararg v: Int) = b.size >= i + v.size && v.indices.all { b[i + it] == v[it].toByte() }
    return when {
        at(0, 0xFF, 0xD8, 0xFF) -> "image/jpeg"
        at(0, 0x89, 0x50, 0x4E, 0x47) -> "image/png"
        at(0, 0x47, 0x49, 0x46, 0x38) -> "image/gif"
        at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50) -> "image/webp"
        at(4, 0x66, 0x74, 0x79, 0x70) && (at(8, 0x61, 0x76, 0x69, 0x66) || at(8, 0x61, 0x76, 0x69, 0x73)) -> "image/avif"
        at(0, 0xFF, 0x0A) || at(4, 0x4A, 0x58, 0x4C, 0x20) -> "image/jxl"
        else -> "application/octet-stream"
    }
}

private fun sha1(s: String) = MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

private fun op(name: String, source: String) = buildJsonObject { put("op", name); put("source", source) }

private fun JsonObject.s(k: String) = (this[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

private fun JsonObject.source(): String = (this["source"] as? JsonPrimitive)?.content?.takeIf { it.toLongOrNull() != null }
    ?: throw ApiError(Kind.invalid, "The request needs source, a source id.")

private fun JsonObject.text(k: String): String = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
    ?: throw ApiError(Kind.invalid, "The request needs the string $k.")

private fun JsonObject.id(k: String): Long = (this[k] as? JsonPrimitive)?.longOrNull
    ?: throw ApiError(Kind.invalid, "The request needs $k, a number.")

/** Runs [block] in one transaction on the database thread. */
fun <T> Connection.transaction(block: () -> T): T {
    autoCommit = false
    try {
        return block().also { commit() }
    } catch (e: Throwable) {
        rollback()
        throw e
    } finally {
        autoCommit = true
    }
}
