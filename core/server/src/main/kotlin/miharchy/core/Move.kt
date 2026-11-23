package miharchy.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import miharchy.sync.ServerConfig
import java.io.IOException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.sql.Connection
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlin.io.path.isDirectory
import kotlin.io.path.isRegularFile
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readText
import kotlin.io.path.writeBytes
import kotlin.math.roundToInt

/** The keys core writes itself: a move from Suwayomi never overwrites them. */
/** The last finished move's report, so `move.status` still says done after core restarts (#385). */
private const val MOVED_KEY = "miharchy.moveReport"

private val CORE_OWN_METAS = setOf(Backups.LAST, Backups.SINCE, "miharchy.lastUpdateTimestamp", MOVED_KEY)

private const val DEFAULT_CATEGORY_KEY = "miharchy.defaultCategory"

/** The helper's sync state that core takes over, so the first sync on core is not a first sync. */
private val HELPER_SYNC_FILES = listOf(Sync.PHONE_BASELINE, Sync.DESKTOP_BASELINE, "pending-since")

/**
 * The move of a v1.1.1 install from Suwayomi-Server to core (#372, ADR 0010): `move.start` runs it as a job, and
 * `move.status` follows it. It reads Suwayomi and never writes to it, so Suwayomi stays the live server until #373.
 *
 * In order: the extension repos and installed extensions; the library from a full Suwayomi backup (`backup.import`);
 * the categories' update and download choices; every global, manga and category meta, with Suwayomi's ids made
 * core's; the server settings, one by one; the downloaded chapters, copied; the helper's sync baselines. A run again
 * gives the same result: each part merges or skips what core already has, and core's own metas and baselines stay.
 * What cannot move goes into `skipped` and does not stop the rest.
 *
 * [call] reaches core's other routes, so each part goes through the same checks as a client's call.
 */
class Move(
    private val db: Database,
    private val downloads: Downloads,
    private val work: Path,
    private val syncState: Path,
    private val call: suspend (String, JsonObject) -> JsonElement,
) : AutoCloseable {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val ops = Mutex()
    @Volatile private var job: Job? = null
    @Volatile private var status: JsonObject = status("idle")

    override fun close() = scope.cancel()

    val routes: Map<String, Route> = mapOf(
        // Idle after a restart: the saved report of the last finished move, if any.
        "move.status" to { _ -> if (status["state"]?.jsonPrimitive?.content == "idle") saved() ?: status else status },
        // serverConfig: the v1.1.1 server.json; serverRoot: Suwayomi's root folder; helperSync: the sync helper's state.
        // Explicit paths only, so a test or a scratch core never reads the real install by default.
        "move.start" to { input ->
            val config = input.path("serverConfig") ?: throw ApiError(Kind.invalid, "The request needs serverConfig, the path of server.json.")
            val root = input.path("serverRoot") ?: throw ApiError(Kind.invalid, "The request needs serverRoot, Suwayomi's root folder.")
            if (!config.isRegularFile()) throw ApiError(Kind.invalid, "$config is not a file.")
            val server = runCatching { Json { ignoreUnknownKeys = true }.decodeFromString(ServerConfig.serializer(), config.readText()) }
                .getOrElse { throw ApiError(Kind.invalid, "$config is not a server.json with url, username and password.") }
            val helper = input.path("helperSync")
            ops.withLock {
                if (job?.isActive != true) {
                    status = status("running", "extensions")
                    job = scope.launch { run(Suwayomi(server), root, helper) }
                }
            }
            status
        },
    )

    private suspend fun saved(): JsonObject? = db.run { c ->
        c.query("SELECT value FROM metas WHERE scope = 'global' AND owner = 0 AND key = ?", MOVED_KEY) { it.getString(1) }.firstOrNull()
    }?.let { text -> runCatching { status("done", null, Json.parseToJsonElement(text).jsonObject) }.getOrNull() }

    private class Report {
        var repos = 0; var extensions = 0; var manga = 0; var metas = 0; var settings = 0; var downloads = 0
        val baselines = mutableListOf<String>()
        val skipped = mutableListOf<String>()
        fun json() = buildJsonObject {
            put("repos", repos); put("extensions", extensions); put("manga", manga); put("metas", metas); put("settings", settings)
            put("downloads", downloads); put("baselines", JsonArray(baselines.map(::JsonPrimitive))); put("skipped", JsonArray(skipped.map(::JsonPrimitive)))
        }
    }

    private suspend fun run(suwayomi: Suwayomi, root: Path, helper: Path?) {
        val report = Report()
        fun step(name: String) { status = status("running", name, report.json()) }
        try {
            step("extensions")
            val settings = suwayomi.query("{ settings { extensionRepos downloadsPath ${SETTINGS.joinToString(" ") { it.key }} } }")["settings"]!!.jsonObject
            moveExtensions(suwayomi, settings, report)
            step("library")
            moveLibrary(suwayomi, report)
            step("metas")
            moveMetas(suwayomi, report)
            step("settings")
            moveSettings(settings, report)
            moveLocalFolder(root, report)
            step("downloads")
            val folder = settings.text("downloadsPath")?.let(Path::of) ?: root.resolve("downloads")
            moveDownloads(suwayomi, folder.resolve("mangas"), report)
            step("baselines")
            if (helper != null) moveBaselines(helper, report)
            val done = report.json()
            db.run { c -> c.putMeta("global", 0, buildJsonObject { put("key", MOVED_KEY); put("value", done.toString()) }) }
            status = status("done", null, done)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (e !is ApiError && e !is IOException) e.printStackTrace()
            val error = e as? ApiError ?: if (e is IOException) ApiError(Kind.network, "Suwayomi did not answer" + (e.message?.let { ": $it" } ?: "") + ". The move needs it running: systemctl --user start miharchy-server.") else ApiError(Kind.internal, e.message ?: e.toString())
            status = status("failed", status["step"]?.jsonPrimitive?.content, report.json(), error)
        }
    }

    private suspend fun moveExtensions(suwayomi: Suwayomi, settings: JsonObject, report: Report) {
        for (url in settings["extensionRepos"]!!.jsonArray.map { it.jsonPrimitive.content }) {
            try { call("extensionRepo.add", buildJsonObject { put("url", url) }); report.repos++ } catch (e: ApiError) { report.skipped += "Repo $url: ${e.message}" }
        }
        val installed = suwayomi.query("{ extensions(condition: { isInstalled: true }) { nodes { pkgName } } }")
            .nodes("extensions").map { it.text("pkgName")!! }
        for (pkg in installed) {
            try { call("extension.install", buildJsonObject { put("pkgName", pkg) }); report.extensions++ } catch (e: ApiError) { report.skipped += "Extension $pkg: ${e.message}" }
        }
    }

    /** Every part of the library, whatever the user's backup rows say; never Suwayomi's server settings, which hold its password. */
    private suspend fun moveLibrary(suwayomi: Suwayomi, report: Report) {
        val url = suwayomi.query(
            "mutation(\$flags: PartialBackupFlagsInput!) { createBackup(input: { flags: \$flags }) { url } }",
            buildJsonObject {
                put("flags", buildJsonObject {
                    listOf("Manga", "Categories", "Chapters", "Tracking", "History").forEach { put("include$it", true) }
                    put("includeClientData", false); put("includeServerSettings", false)
                })
            },
        )["createBackup"]!!.jsonObject.text("url")!!
        val file = work.resolve("move-from-suwayomi.tachibk")
        try {
            val bytes = suwayomi.file(url)
            withContext(Dispatchers.IO) { Files.createDirectories(work); file.writeBytes(bytes) }
            report.manga = call("backup.import", buildJsonObject { put("file", file.toString()) }).jsonObject["manga"]!!.jsonPrimitive.content.toInt()
        } finally {
            withContext(Dispatchers.IO) { Files.deleteIfExists(file) }
        }
    }

    /**
     * Metas with Suwayomi's ids made core's: manga by source and URL, categories by name. A backup carries none of them,
     * nor a manga's last chapter fetch, which the library check reads (#394).
     */
    private suspend fun moveMetas(suwayomi: Suwayomi, report: Report) {
        val data = suwayomi.query(
            """{
              metas { nodes { key value } }
              categories { nodes { id name includeInUpdate includeInDownload meta { key value } } }
              mangas { nodes { sourceId url chaptersLastFetchedAt meta { key value } } }
            }""",
        )
        val categories = data.nodes("categories")
        db.run { c ->
            c.transaction {
                val categoryIds = c.query("SELECT id, name FROM category") { it.getString(2) to it.getLong(1) }.toMap()
                // Default is 0 on both servers, whatever its name.
                fun coreCategory(suwayomiId: String): Long? =
                    if (suwayomiId == "0") 0L else categories.firstOrNull { it.raw("id") == suwayomiId }?.text("name")?.let(categoryIds::get)
                for (cat in categories) {
                    val id = coreCategory(cat.raw("id")!!)
                    if (id == null) { report.skipped += "Category ${cat.text("name")}: the backup did not carry it."; continue }
                    c.update("UPDATE category SET include_in_update = ?, include_in_download = ? WHERE id = ?", cat.text("includeInUpdate"), cat.text("includeInDownload"), id)
                    cat["meta"]!!.jsonArray.forEach { report.metas += c.putMeta("category", id, it.jsonObject) }
                }
                for (meta in data.nodes("metas")) {
                    val key = meta.text("key")!!
                    if (key in CORE_OWN_METAS || isCoreSetting(key)) continue
                    // A category id, or "ask". An id core cannot map becomes "ask", never a Suwayomi id that is another category on core.
                    val value = if (key == DEFAULT_CATEGORY_KEY) meta.text("value")?.let { v ->
                        if (v.toLongOrNull() == null) v else coreCategory(v)?.toString() ?: "ask".also { report.skipped += "Default category $v: core has no such category, so the window asks." }
                    } else meta.text("value")
                    report.metas += c.putMeta("global", 0, buildJsonObject { put("key", key); put("value", value) })
                }
                val mangaIds = c.query("SELECT source_id, remote_url, id FROM manga") { (it.getLong(1).toString() to it.getString(2)) to it.getLong(3) }.toMap()
                var orphans = 0
                for (manga in data.nodes("mangas")) {
                    // Seconds on Suwayomi, ms here; a later fetch on core wins.
                    val fetched = manga.raw("chaptersLastFetchedAt")?.toLongOrNull()?.takeIf { it > 0 }
                    mangaIds[manga.text("sourceId") to manga.text("url")]?.let { id ->
                        if (fetched != null) c.update("UPDATE manga SET state_chapter_last_update = max(coalesce(state_chapter_last_update, 0), ?) WHERE id = ?", fetched * 1000, id)
                    }
                    val metas = manga["meta"]!!.jsonArray
                    if (metas.isEmpty()) continue
                    val id = mangaIds[manga.text("sourceId") to manga.text("url")]
                    if (id == null) orphans += metas.size else metas.forEach { report.metas += c.putMeta("manga", id, it.jsonObject) }
                }
                if (orphans > 0) report.skipped += "$orphans manga metas: their manga are not in Suwayomi's library, so the backup did not carry them."
            }
        }
    }

    /** One by one, so a value core's rules refuse skips that row only. */
    private suspend fun moveSettings(settings: JsonObject, report: Report) {
        for (s in SETTINGS) {
            // Suwayomi's downloads folder is where its downloads are read from, not where core puts its own: a move of core's downloads into it is never wanted.
            if (s.key == "downloadsPath") continue
            val value = settings[s.key] as? JsonPrimitive ?: continue
            // Suwayomi keeps the update interval as a float of hours.
            val typed = if (!value.isString && value.booleanOrNull == null && s.default.content.toIntOrNull() != null) value.doubleOrNull?.roundToInt()?.let(::JsonPrimitive) ?: value else value
            try {
                call("settings.set", buildJsonObject { put("settings", buildJsonObject { put(s.key, typed) }) })
                report.settings++
            } catch (e: ApiError) {
                report.skipped += "Setting ${s.key}: ${e.message}"
            }
        }
    }

    /**
     * Suwayomi's local manga sit in `<root>/local` when its own setting is blank, which the settings step just copied. Core then
     * reads that folder, when it holds manga; a folder the user set is never changed.
     */
    private suspend fun moveLocalFolder(root: Path, report: Report) {
        val folder = root.resolve("local").toAbsolutePath()
        val set = call("settings.get", JsonObject(emptyMap())).jsonObject["settings"]!!.jsonObject["localSourcePath"]!!.jsonPrimitive.content
        if (set.isNotEmpty() || !withContext(Dispatchers.IO) { folder.isDirectory() && folder.listDirectoryEntries().any { it.isDirectory() } }) return
        try {
            call("settings.set", buildJsonObject { put("settings", buildJsonObject { put("localSourcePath", folder.toString()) }) })
            report.settings++
        } catch (e: ApiError) {
            report.skipped += "Setting localSourcePath: ${e.message}"
        }
    }

    /** Each downloaded chapter, copied under core's names: a `.cbz` as it is, a folder of pages zipped. Suwayomi keeps its files. */
    private suspend fun moveDownloads(suwayomi: Suwayomi, folder: Path, report: Report) {
        val chapters = suwayomi.query(
            "{ chapters(condition: { isDownloaded: true }) { nodes { url name scanlator manga { sourceId url title source { displayName } } } } }",
        ).nodes("chapters")
        for (ch in chapters) {
            val manga = ch["manga"]!!.jsonObject
            val label = "${manga.text("title")} ${ch.text("name")}"
            val id = db.run { c ->
                c.query(
                    "SELECT ch.id FROM chapter ch JOIN manga m ON m.id = ch.manga_id WHERE m.source_id = ? AND m.remote_url = ? AND ch.remote_url = ?",
                    manga.text("sourceId")!!.toLong(), manga.text("url"), ch.text("url"),
                ) { it.getLong(1) }.firstOrNull()
            }
            if (id == null) { report.skipped += "Download $label: core has no such chapter (its manga is not in the library)."; continue }
            // Suwayomi's DirName.kt at v2.4.2366: <source>/<manga>/<scanlator>_<chapter>, a .cbz or a folder of pages, with
            // Mihon's filename rules. A source no extension provides is its id; an empty scanlator still adds the "_".
            val source = (manga["source"] as? JsonObject)?.text("displayName") ?: manga.raw("sourceId")!!
            val scanlator = (ch["scanlator"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            val chapterName = ch.raw("name").orEmpty()
            val dir = folder.resolve(validName(source)).resolve(validName(manga.text("title")!!))
                .resolve(validName(if (scanlator != null) "${scanlator}_$chapterName" else chapterName))
            val cbz = dir.resolveSibling(dir.name + ".cbz")
            try {
                val moved = when {
                    // Suwayomi reads the .cbz first when both exist.
                    cbz.isRegularFile() -> downloads.adopt(id) { part -> copyOrLink(cbz, part) }
                    dir.isDirectory() -> downloads.adopt(id) { part -> zipPages(dir, part) }
                    else -> { report.skipped += "Download $label: no file at $dir."; continue }
                }
                if (moved) report.downloads++
            } catch (e: Exception) {
                // One unreadable file or a full disk skips that chapter only.
                if (e !is ApiError && e !is IOException) throw e
                report.skipped += "Download $label: ${e.message ?: e.toString()}"
            }
        }
    }

    /** The helper's baselines, only where core has none of its own yet. */
    private suspend fun moveBaselines(helper: Path, report: Report) = withContext(Dispatchers.IO) {
        Files.createDirectories(syncState)
        for (name in HELPER_SYNC_FILES) {
            val from = helper.resolve(name)
            val to = syncState.resolve(name)
            if (from.isRegularFile() && !Files.exists(to)) {
                Files.copy(from, to, StandardCopyOption.COPY_ATTRIBUTES)
                report.baselines += name
            }
        }
    }

    private fun status(state: String, step: String? = null, report: JsonObject? = null, error: ApiError? = null) = buildJsonObject {
        put("state", state)
        put("step", step)
        put("report", report ?: JsonNull)
        put("error", error?.let { buildJsonObject { put("kind", it.kind.name); put("message", it.message) } } ?: JsonNull)
    }
}

/** Upserts one `{ key, value }` meta; 1 when it was written. */
private fun Connection.putMeta(scope: String, owner: Long, meta: JsonObject): Int {
    val key = meta.text("key") ?: return 0
    val value = meta.text("value") ?: return 0
    return update(
        "INSERT INTO metas (scope, owner, key, value) VALUES (?, ?, ?, ?) ON CONFLICT (scope, owner, key) DO UPDATE SET value = excluded.value",
        scope, owner, key, value,
    )
}

/** A hard link when both folders share a disk, so a big library takes no more space; a copy otherwise. */
private fun copyOrLink(from: Path, to: Path) {
    try {
        Files.createLink(to, from)
    } catch (_: Exception) {
        Files.copy(from, to, StandardCopyOption.REPLACE_EXISTING)
    }
}

/** A folder of pages as a `.cbz`, pages in name order, other files such as `ComicInfo.xml` left out. */
private fun zipPages(dir: Path, to: Path) {
    val pages = dir.listDirectoryEntries().filter { it.isRegularFile() && isPageName(it.name) }.sortedBy { it.name }
    if (pages.isEmpty()) throw ApiError(Kind.notFound, "$dir holds no pages.")
    ZipOutputStream(Files.newOutputStream(to)).use { zip ->
        zip.setLevel(0)
        for (p in pages) {
            zip.putNextEntry(ZipEntry(p.name))
            Files.copy(p, zip)
            zip.closeEntry()
        }
    }
}

private fun JsonObject.nodes(k: String) = this[k]!!.jsonObject["nodes"]!!.jsonArray.map { it.jsonObject }
private fun JsonObject.text(k: String) = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotBlank() }
private fun JsonObject.raw(k: String) = (this[k] as? JsonPrimitive)?.content
private fun JsonObject.path(k: String) = text(k)?.let(Path::of)
