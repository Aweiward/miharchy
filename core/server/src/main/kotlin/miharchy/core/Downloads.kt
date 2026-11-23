package miharchy.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream
import kotlin.io.path.name

/**
 * The download queue (#367, ADR 0010). Chapters go to `<root>/<source>/<manga>/<chapter>.cbz` with Mihon's names
 * (`DownloadProvider`, `DiskUtil.buildValidFilename` at mihonapp/mihon@1ed58f5e). Every route answers with the
 * status, `{ state: "STARTED" | "STOPPED", queue }`, and the `downloads` topic sends it on each change.
 *
 * ponytail: one chapter at a time, and the folder is `<data>/downloads`: the `downloadsPath` setting is stored only.
 */
class Downloads(private val db: Database, private val browse: Browse, private val extensions: Extensions, private val root: Path) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    // Route changes one at a time; the worker reads and writes the queue on the database's own thread.
    private val ops = Mutex()
    @Volatile private var running = false
    @Volatile private var worker: Job? = null
    @Volatile private var current: Long? = null
    @Volatile private var progress = 0.0
    private val state = MutableStateFlow<JsonElement>(JsonNull)
    // One status at a time, so an older one never lands after a newer one. Before init, which publishes.
    private val publishing = Mutex()

    /** The status: the whole of it on subscribe, then each change. */
    val status: StateFlow<JsonElement> get() = state

    init {
        Files.createDirectories(root)
        // A .part is a download a crash or restart cut short; its chapter is still QUEUED.
        Files.walk(root).use { s -> s.filter { it.name.endsWith(".part") }.toList() }.forEach(Files::deleteIfExists)
        runBlocking { publish() }
    }

    val routes: Map<String, Route> = mapOf(
        "download.queue" to { _ -> statusJson() },
        "download.enqueue" to { input -> change { enqueue(input.longs("ids")); running = true } },
        "download.dequeue" to { input -> val ids = input.longs("ids"); change(ids) { dequeue(ids) } },
        "download.reorder" to { input ->
            if ("order" in input) change { reorder(input.longs("order")) }
            else {
                val id = input.long("chapterId")
                val to = (input["to"] as? JsonPrimitive)?.intOrNull ?: throw ApiError(Kind.invalid, "to is a queue position from 0.")
                change { reorder(id, to) }
            }
        },
        "download.start" to { _ -> change { running = true } },
        "download.stop" to { _ -> change(stop = true) { running = false } },
        "download.clear" to { _ -> change(stop = true) { running = false; db.run { c -> c.update("DELETE FROM download_queue") } } },
        "download.delete" to { input ->
            val ids = input.longs("ids")
            // The status too, as every route here: the queue lost these chapters.
            val status = change(ids) { dequeue(ids); delete(ids) }
            JsonObject(status + ("chapters" to JsonArray(db.run { c -> chapterRows(c, among("ch.id"), idList(ids)) }.map { buildJsonObject { put("id", it["id"]!!); put("isDownloaded", it["isDownloaded"]!!) } })))
        },
    )

    /**
     * One change: the worker stops first when [stop] is set or it downloads one of [cancel], so no file is
     * half written when its rows go. It starts again after, when the queue runs.
     */
    private suspend fun change(cancel: List<Long> = emptyList(), stop: Boolean = false, block: suspend () -> Unit): JsonObject {
        ops.withLock {
            if (stop || current in cancel) worker?.cancelAndJoin()
            block()
            if (running && worker?.isActive != true) worker = scope.launch { loop() }
        }
        publish()
        return statusJson()
    }

    /** Auto-download (#424): queues [ids] and starts the downloader, as `download.enqueue`. */
    // ponytail: starts at once, as Suwayomi; Mihon starts after the update run, the fix if sites rate-limit core.
    internal suspend fun auto(ids: List<Long>) { change { enqueue(ids); running = true } }

    private suspend fun enqueue(ids: List<Long>) = db.run { c ->
        c.transaction {
            val found = c.query("SELECT id FROM chapter WHERE ${among("id")}", idList(ids)) { it.getLong(1) }.toSet()
            (ids - found).firstOrNull()?.let { throw ApiError(Kind.notFound, "There is no chapter $it.") }
            // A failed chapter goes back in line where it is and keeps its tries.
            c.update("UPDATE download_queue SET state = 'QUEUED', error_kind = NULL, error_message = NULL WHERE ${among("chapter_id")}", idList(ids))
            var next = c.query("SELECT coalesce(max(position), -1) + 1 FROM download_queue") { it.getInt(1) }.single()
            val todo = c.query(
                // Local chapters are files already (#374): dropped with no error.
                """SELECT id FROM chapter WHERE ${among("id")} AND download_path IS NULL AND id NOT IN (SELECT chapter_id FROM download_queue)
                   AND manga_id NOT IN (SELECT id FROM manga WHERE source_id = $LOCAL_SOURCE)""", idList(ids),
            ) { it.getLong(1) }.toSet()
            c.batch("INSERT INTO download_queue (chapter_id, position) VALUES (?, ?)", ids.distinct().filter { it in todo }.map { listOf(it, next++) })
        }
    }

    private suspend fun dequeue(ids: List<Long>) = db.run { c -> c.update("DELETE FROM download_queue WHERE ${among("chapter_id")}", idList(ids)) }

    private suspend fun reorder(id: Long, to: Int) = db.run { c ->
        c.transaction {
            val order = c.query("SELECT chapter_id FROM download_queue ORDER BY position") { it.getLong(1) }.toMutableList()
            if (!order.remove(id)) throw ApiError(Kind.notFound, "Chapter $id is not in the queue.")
            if (to < 0 || to > order.size) throw ApiError(Kind.invalid, "to is from 0 to ${order.size}.")
            order.add(to, id)
            c.batch("UPDATE download_queue SET position = ? WHERE chapter_id = ?", order.mapIndexed { i, ch -> listOf(i, ch) })
        }
    }

    /**
     * The whole queue in [order]. The window's copy can lag the queue, so ids no longer queued are skipped,
     * and queued ids it does not name keep their order after the rest.
     */
    private suspend fun reorder(order: List<Long>) = db.run { c ->
        c.transaction {
            val now = c.query("SELECT chapter_id FROM download_queue ORDER BY position") { it.getLong(1) }
            val named = order.distinct().filter { it in now }
            c.batch("UPDATE download_queue SET position = ? WHERE chapter_id = ?", (named + (now - named.toSet())).mapIndexed { i, ch -> listOf(i, ch) })
        }
    }

    private suspend fun delete(ids: List<Long>) {
        val files = db.run { c ->
            c.transaction {
                val rels = c.query("SELECT download_path FROM chapter WHERE ${among("id")} AND download_path IS NOT NULL", idList(ids)) { it.getString(1) }
                c.update("UPDATE chapter SET download_path = NULL WHERE ${among("id")}", idList(ids))
                rels
            }
        }
        withContext(Dispatchers.IO) { files.forEach { Files.deleteIfExists(inside(root, it)) } }
    }

    /**
     * Downloads the first QUEUED chapter until none is left; then the downloader stops. The pick and the stop
     * happen under [ops], so an enqueue either lands before the pick or finds no worker and starts one.
     */
    private suspend fun loop() {
        while (true) {
            val next = ops.withLock {
                val id = if (!running) null else db.run { c ->
                    c.query("SELECT chapter_id FROM download_queue WHERE state = 'QUEUED' ORDER BY position LIMIT 1") { it.getLong(1) }.firstOrNull()
                }
                current = id
                progress = 0.0
                if (id == null) {
                    running = false
                    worker = null
                }
                id
            } ?: break
            publish()
            try {
                download(next)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val error = e as? ApiError ?: ApiError(Kind.source, e.message ?: e.javaClass.simpleName)
                db.run { c ->
                    c.update("UPDATE download_queue SET state = 'ERROR', tries = tries + 1, error_kind = ?, error_message = ? WHERE chapter_id = ?", error.kind.name, error.message, next)
                }
            } finally {
                current = null
            }
        }
        publish()
    }

    private suspend fun download(id: Long) {
        val (source, rel) = target(id)
        val file = inside(root, rel)
        val part = file.resolveSibling(file.name + ".part")
        val (_, list) = browse.pageList(id)
        if (list.isEmpty()) throw ApiError(Kind.source, "Chapter does not have any pages to download")
        try {
            withContext(Dispatchers.IO) { Files.createDirectories(file.parent) }
            ZipOutputStream(Files.newOutputStream(part)).use { zip ->
                // Images are compressed already.
                zip.setLevel(0)
                for (i in list.indices) {
                    val image = browse.fetchPage(id, i)
                    // An error page is not a page, as for covers.
                    if (!image.contentType.startsWith("image/")) throw ApiError(Kind.source, "Page ${i + 1} of $source is not an image.")
                    withContext(Dispatchers.IO) {
                        zip.putNextEntry(ZipEntry("%03d.%s".format(i + 1, image.contentType.removePrefix("image/").replace("jpeg", "jpg"))))
                        zip.write(image.bytes)
                        zip.closeEntry()
                    }
                    progress = (i + 1).toDouble() / list.size
                    publish()
                }
            }
            // The move and its row go together: a cancel here would leave a file no row points to.
            withContext(NonCancellable + Dispatchers.IO) {
                Files.move(part, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
                // Dequeued while the last page wrote: the file goes, and the chapter stays not downloaded.
                val kept = db.run { c ->
                    c.transaction {
                        val queued = c.update("DELETE FROM download_queue WHERE chapter_id = ?", id) == 1
                        if (queued) c.update("UPDATE chapter SET download_path = ? WHERE id = ?", rel, id)
                        queued
                    }
                }
                if (!kept) Files.deleteIfExists(file)
            }
        } finally {
            // Blocking on purpose: a withContext in a cancelled coroutine throws before it runs.
            Files.deleteIfExists(part)
        }
    }

    /**
     * A chapter a v1.1.1 install downloaded (#372): [write] writes its `.cbz` to the path it gets, and the file lands
     * under Mihon's names as a download does. A chapter core already has downloaded stays as it is, and this is false.
     */
    suspend fun adopt(id: Long, write: (Path) -> Unit): Boolean = ops.withLock {
        if (db.run { c -> c.query("SELECT 1 FROM chapter WHERE id = ? AND download_path IS NOT NULL", id) { 1 }.isNotEmpty() }) return@withLock false
        val (_, rel) = target(id)
        val file = inside(root, rel)
        val part = file.resolveSibling(file.name + ".part")
        withContext(NonCancellable + Dispatchers.IO) {
            try {
                Files.createDirectories(file.parent)
                write(part)
                Files.move(part, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
            } finally {
                Files.deleteIfExists(part)
            }
            db.run { c -> c.update("UPDATE chapter SET download_path = ? WHERE id = ?", rel, id) }
        }
        true
    }

    /** The source's name and the chapter's path under [root], Mihon's names; a second chapter with the same name gets Mihon's hash suffix. */
    private suspend fun target(id: Long): Pair<String, String> {
        val sources = extensions.sources().associate { it["id"]!!.jsonPrimitive.content to it["displayName"]!!.jsonPrimitive.content }
        return db.run { c ->
            val (sourceId, title, name, scanlator, url) = c.query(
                "SELECT m.source_id, m.remote_title, ch.remote_name, ch.remote_scanlator, ch.remote_url FROM chapter ch JOIN manga m ON m.id = ch.manga_id WHERE ch.id = ?", id,
            ) { r -> listOf(r.getLong(1).toString(), r.getString(2), r.getString(3), r.getString(4), r.getString(5)) }.single()
            val source = sources[sourceId] ?: throw ApiError(Kind.notFound, "Source not installed")
            val chapter = chapterDirName(name!!, scanlator)
            val dir = "${validName(source)}/${validName(title!!)}"
            val taken = c.query("SELECT 1 FROM chapter WHERE download_path = ? AND id != ?", "$dir/$chapter.cbz", id) { 1 }.isNotEmpty()
            source to "$dir/${if (taken) chapter + "_" + md5(url!!).take(6) else chapter}.cbz"
        }
    }

    private suspend fun publish() = publishing.withLock {
        state.value = statusJson()
    }

    private suspend fun statusJson(): JsonObject {
        val sources = extensions.sources().map { it["id"]!!.jsonPrimitive.content }.toSet()
        val now = current
        val queue = db.run { c ->
            c.query(
                """SELECT q.chapter_id, q.state, q.tries, q.error_kind, q.error_message, ch.remote_name, ch.manga_id, ch.remote_chapter_number,
                          ch.remote_date_upload, m.remote_title, m.source_id
                   FROM download_queue q JOIN chapter ch ON ch.id = q.chapter_id JOIN manga m ON m.id = ch.manga_id ORDER BY q.position""",
            ) { r ->
                val id = r.getLong(1)
                buildJsonObject {
                    put("state", if (id == now) "DOWNLOADING" else r.getString(2))
                    put("progress", if (id == now) progress else 0.0)
                    put("tries", r.getInt(3))
                    put("error", r.getString(4)?.let { kind -> buildJsonObject { put("kind", kind); put("message", r.getString(5)) } } ?: JsonNull)
                    put("chapter", buildJsonObject {
                        put("id", id); put("name", r.getString(6)); put("mangaId", r.getLong(7)); put("chapterNumber", r.getDouble(8)); put("uploadDate", r.getLong(9))
                    })
                    val source = r.getLong(11).toString()
                    put("manga", buildJsonObject {
                        put("id", r.getLong(7)); put("title", r.getString(10))
                        put("source", if (source in sources) buildJsonObject { put("id", source) } else JsonNull)
                    })
                }
            }
        }
        return buildJsonObject { put("state", if (running) "STARTED" else "STOPPED"); put("queue", JsonArray(queue)) }
    }
}

/** [rel] under [root], refused when it would leave it: the downloads and the local manga folder take paths from backups and the sync. */
fun inside(root: Path, rel: String): Path {
    val base = root.toAbsolutePath().normalize()
    val p = try { base.resolve(rel).normalize() } catch (e: java.nio.file.InvalidPathException) { throw ApiError(Kind.invalid, "$rel is not a path.") }
    if (!p.startsWith(base) || p == base) throw ApiError(Kind.invalid, "$rel is outside its folder.")
    return p
}

/** The page entries of a .cbz, in natural order (core's own are zero-padded, so it is their name order): images only, so `ComicInfo.xml` is no page. */
fun cbzPages(file: Path): List<String> = ZipFile(file.toFile()).use { z -> pageEntries(z) }

// A Mac's zip adds `__MACOSX/._<name>` files, which carry image names but no image.
private fun pageEntries(z: ZipFile) = z.entries().asSequence()
    .filter { !it.isDirectory && isPageName(it.name) && !it.name.startsWith("__MACOSX/") && !it.name.substringAfterLast('/').startsWith(".") }
    .map { it.name }.sortedWith(NATURAL).toList()

/** An image by its extension, as Mihon's `ImageUtil.isImage` reads a file name. */
fun isPageName(name: String) = name.substringAfterLast('.', "").lowercase() in setOf("jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "heif", "jxl", "bmp")

fun cbzPage(file: Path, index: Int): ByteArray? = ZipFile(file.toFile()).use { z ->
    val name = pageEntries(z).elementAtOrNull(index) ?: return null
    z.getInputStream(z.getEntry(name)).use { it.readBytes() }
}

/** Mihon's `ChapterDirNameParts.dirName` with no hash and ASCII allowed: the scanlator and the name made valid together. */
fun chapterDirName(name: String, scanlator: String?): String =
    validName(if (scanlator.isNullOrBlank()) name.ifBlank { "Chapter" } else "${scanlator}_${name.ifBlank { "Chapter" }}", MAX_NAME_BYTES - 11)

const val MAX_NAME_BYTES = 240

/** Mihon's `DiskUtil.buildValidFilename`: FAT's forbidden characters become `_`, and the name fits [maxBytes] of UTF-8. */
fun validName(orig: String, maxBytes: Int = MAX_NAME_BYTES): String {
    val name = orig.trim('.', ' ')
    if (name.isEmpty()) return "(invalid)"
    val sb = StringBuilder(name.length)
    for (ch in name) sb.append(if (ch in '\u0000'..'\u001f' || ch in "\"*/:<>?\\|\u007f") '_' else ch)
    val bytes = sb.toString().toByteArray(Charsets.UTF_8)
    if (bytes.size <= maxBytes) return sb.toString()
    val out = CharBuffer.allocate(maxBytes)
    Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.IGNORE).apply { decode(ByteBuffer.wrap(bytes, 0, maxBytes), out, true); flush(out) }
    return String(out.array(), 0, out.position())
}

private fun md5(s: String) = MessageDigest.getInstance("MD5").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
