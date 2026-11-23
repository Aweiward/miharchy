package miharchy.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put
import miharchy.sync.backupRefusal
import java.nio.file.Files
import java.nio.file.Path
import java.sql.Connection
import kotlin.io.path.isDirectory
import kotlin.io.path.isRegularFile
import kotlin.io.path.name

/**
 * One server setting (#375): the rows `window/Settings.js` stores on Suwayomi with `setSettings`. Core keeps each as
 * global meta `miharchy.<key>`, a string (`"true"`, `"12"`), where the window's own Settings rows live too.
 * [applied] is false while core stores the value and does nothing with it yet.
 */
class Setting(val key: String, val default: JsonPrimitive, val applied: Boolean, val rule: String, private val accepts: (JsonPrimitive) -> Boolean) {
    /** The stored text as a value, or the default when it is missing or not one the rule takes (`meta.set` writes anything). */
    fun read(text: String?): JsonPrimitive {
        val value = when {
            text == null -> return default
            default.isString -> JsonPrimitive(text)
            default.booleanOrNull != null -> text.toBooleanStrictOrNull()?.let(::JsonPrimitive)
            else -> text.toIntOrNull()?.let(::JsonPrimitive)
        }
        return value?.takeIf(accepts) ?: default
    }

    /** The text to store for [value], or null when the rule refuses it. */
    fun text(value: JsonPrimitive): String? {
        val typed = when {
            default.isString -> value.takeIf { it.isString }
            default.booleanOrNull != null -> value.takeIf { !it.isString && it.booleanOrNull != null }
            else -> value.takeIf { !it.isString && it.intOrNull != null }
        }
        return typed?.takeIf(accepts)?.content
    }
}

private val PATH = Regex("^(/.*)?$")
private fun bool(key: String, default: Boolean, applied: Boolean) = Setting(key, JsonPrimitive(default), applied, "true or false") { true }
private fun path(key: String, applied: Boolean) =
    Setting(key, JsonPrimitive(""), applied, "an absolute path, or \"\" for core's own folder") { PATH.matches(it.content) }
private fun choice(key: String, default: Int, options: List<Int>, applied: Boolean) =
    Setting(key, JsonPrimitive(default), applied, "one of ${options.joinToString(", ")}") { it.intOrNull in options }

/** In `window/Settings.js`'s order, with its defaults. */
val SETTINGS: List<Setting> = listOf(
    // The host's FlareSolverr fallback (#361) reads these on each challenge, see [solver]. Settings turns the
    // fallback on with FlareSolverr.
    bool("flareSolverrEnabled", false, applied = true),
    Setting("flareSolverrUrl", JsonPrimitive("http://127.0.0.1:8191"), true, "a URL that starts with http:// or https://") {
        Regex("^https?://\\S+$").matches(it.content)
    },
    bool("flareSolverrAsResponseFallback", false, applied = true),
    // The host has no WebView.
    bool("kcefEnabled", true, applied = false),
    // Suwayomi's rule: off, or at least 6 hours.
    Setting("globalUpdateInterval", JsonPrimitive(12), true, "0, or a number of hours of at least 6") { it.intOrNull.let { h -> h == 0 || h != null && h >= 6 } },
    bool("excludeUnreadChapters", true, applied = true),
    bool("excludeNotStarted", true, applied = true),
    bool("excludeCompleted", true, applied = true),
    // A refresh always fetches the details.
    bool("updateMangas", false, applied = false),
    // ponytail: stored only; the download queue writes to <core data>/downloads. A live folder first needs the queue's
    // start-up sweep of *.part files kept to core's own files, and a plan for download_path marks under the old root.
    path("downloadsPath", applied = false),
    // Local.kt reads it on each call; blank is <core data>/local.
    path("localSourcePath", applied = true),
    // AutoDownload.kt reads these on each refresh.
    bool("autoDownloadNewChapters", false, applied = true),
    bool("excludeEntryWithUnreadChapters", true, applied = true),
    bool("autoDownloadIgnoreReUploads", false, applied = true),
    path("backupPath", applied = true),
    choice("backupInterval", 1, listOf(0, 1, 2, 3, 7), applied = true),
    Setting("backupTime", JsonPrimitive("00:00"), true, "a time as HH:MM, such as 21:30") { Regex("^([01]\\d|2[0-3]):[0-5]\\d$").matches(it.content) },
    choice("backupTTL", 14, listOf(7, 14, 30, 90, 0), applied = true),
    bool("autoBackupIncludeCategories", true, applied = true),
    bool("autoBackupIncludeChapters", true, applied = true),
    bool("autoBackupIncludeTracking", true, applied = true),
    bool("autoBackupIncludeHistory", true, applied = true),
)

private val BY_KEY = SETTINGS.associateBy { it.key }

const val SETTINGS_PREFIX = "miharchy."

/** The FlareSolverr-format solver the settings name, null when it is off (#361). */
fun solver(c: Connection): eu.kanade.tachiyomi.network.Solver? =
    if (setting(c, "flareSolverrEnabled").content != "true") null
    else eu.kanade.tachiyomi.network.Solver(setting(c, "flareSolverrUrl").content, setting(c, "flareSolverrAsResponseFallback").content == "true")

/** A setting's value now, its default when unset or unreadable. */
fun setting(c: Connection, key: String): JsonPrimitive {
    val s = BY_KEY.getValue(key)
    return s.read(c.query("SELECT value FROM metas WHERE scope = 'global' AND owner = 0 AND key = ?", SETTINGS_PREFIX + key) { it.getString(1) }.firstOrNull())
}

/** What backups carry, by the autoBackupInclude rows. */
fun backupParts(c: Connection) = Parts(
    setting(c, "autoBackupIncludeCategories").content == "true", setting(c, "autoBackupIncludeChapters").content == "true",
    setting(c, "autoBackupIncludeTracking").content == "true", setting(c, "autoBackupIncludeHistory").content == "true",
)

/** The backup folder row, or [default] when it is blank. */
fun backupFolder(c: Connection, default: Path): Path = setting(c, "backupPath").content.takeIf { it.isNotEmpty() }?.let(Path::of) ?: default

/**
 * `settings.get`, `settings.set` and `cache.clear` (#375, ADR 0010). [covers] is the cover cache, core's only cache:
 * chapter pages are read from the source or from a download, never kept.
 */
class Settings(
    private val db: Database, private val covers: Path, private val downloads: Path = covers.resolveSibling("downloads"),
    private val localDefault: Path = covers.resolveSibling("local"),
) {
    val routes: Map<String, Route> = mapOf(
        "settings.get" to { _ -> db.run { c -> reply(c) } },
        "settings.set" to { input -> set(input) },
        "cache.clear" to { _ -> buildJsonObject { put("freed", clearCovers()) } },
        // Settings' storage rows (#385): the window cannot know core's data folder, so core measures it.
        "storage.get" to { _ -> storage() },
    )

    /** `{ settings: { key: value } }`, some or all keys; all are checked before any is stored. */
    private suspend fun set(input: JsonObject): JsonElement {
        val changes = input["settings"] as? JsonObject ?: throw ApiError(Kind.invalid, "The request needs settings, an object of keys and values.")
        val texts = changes.mapValues { (key, value) ->
            val s = BY_KEY[key] ?: throw ApiError(Kind.invalid, "Core has no setting $key.")
            (value as? JsonPrimitive)?.let(s::text) ?: throw ApiError(Kind.invalid, "$key takes ${s.rule}.")
        }
        return db.run { c ->
            texts["backupPath"]?.takeIf { it.isNotEmpty() }?.let { folder ->
                if (!Path.of(folder).isDirectory()) throw ApiError(Kind.invalid, "$folder is not a folder.")
                val sync = c.query("SELECT value FROM metas WHERE scope = 'global' AND owner = 0 AND key = ?", Sync.SYNC_FOLDER_KEY) { it.getString(1) }.firstOrNull()
                backupRefusal(folder, sync?.takeIf { it.isNotBlank() })?.let { throw ApiError(Kind.invalid, it) }
            }
            c.transaction {
                c.batch(
                    "INSERT INTO metas (scope, owner, key, value) VALUES ('global', 0, ?, ?) ON CONFLICT (scope, owner, key) DO UPDATE SET value = excluded.value",
                    texts.map { (key, text) -> listOf(SETTINGS_PREFIX + key, text) },
                )
            }
            reply(c)
        }
    }

    /** Every setting, and the keys core stores but does not act on yet. */
    private fun reply(c: Connection) = buildJsonObject {
        put("settings", buildJsonObject { SETTINGS.forEach { put(it.key, setting(c, it.key)) } })
        put("unapplied", JsonArray(SETTINGS.filterNot { it.applied }.map { JsonPrimitive(it.key) }))
        // The folder the local source reads, which the window cannot know (#374).
        put("localFolder", localFolder(c, localDefault).toAbsolutePath().normalize().toString())
    }

    /**
     * Deletes the cached covers of manga outside the library and answers the bytes freed. The library's covers stay, as
     * Suwayomi's clear keeps its downloaded thumbnails, and so does a cover being written (`.part`).
     */
    private suspend fun clearCovers(): Long {
        val library = db.run { c -> c.query("SELECT id FROM manga WHERE user_favorite_at IS NOT NULL") { it.getLong(1).toString() }.toSet() }
        return kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { clearOutside(library) }
    }

    /** `{ downloads, cache }` in bytes: the downloads folder, and the covers `cache.clear` would delete. */
    private suspend fun storage(): JsonElement {
        val library = db.run { c -> c.query("SELECT id FROM manga WHERE user_favorite_at IS NOT NULL") { it.getLong(1).toString() }.toSet() }
        return kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            val downloaded = if (downloads.isDirectory()) Files.walk(downloads).use { s -> s.filter { it.isRegularFile() }.mapToLong { runCatching { Files.size(it) }.getOrDefault(0L) }.sum() } else 0L
            buildJsonObject {
                put("downloads", downloaded); put("cache", outside(library).sumOf { runCatching { Files.size(it) }.getOrDefault(0L) })
            }
        }
    }

    private fun outside(library: Set<String>): List<Path> {
        if (!covers.isDirectory()) return emptyList()
        // A cover file is `<manga id>-<hash of its URL>`.
        return Files.list(covers).use { s -> s.filter { it.isRegularFile() && !it.name.endsWith(".part") && it.name.substringBefore('-') !in library }.toList() }
    }

    private fun clearOutside(library: Set<String>): Long {
        return outside(library).sumOf { f -> runCatching { Files.size(f).also { Files.delete(f) } }.getOrDefault(0L) }
    }
}
