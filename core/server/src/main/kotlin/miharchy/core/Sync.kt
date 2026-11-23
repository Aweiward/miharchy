package miharchy.core

import eu.kanade.tachiyomi.data.backup.models.Backup
import eu.kanade.tachiyomi.data.backup.models.BackupCategory
import eu.kanade.tachiyomi.data.backup.models.BackupChapter
import eu.kanade.tachiyomi.data.backup.models.BackupHistory
import eu.kanade.tachiyomi.data.backup.models.BackupManga
import eu.kanade.tachiyomi.data.backup.models.BackupPreference
import eu.kanade.tachiyomi.data.backup.models.BackupSource
import eu.kanade.tachiyomi.data.backup.models.BackupTracking
import eu.kanade.tachiyomi.data.backup.models.StringPreferenceValue
import eu.kanade.tachiyomi.source.model.UpdateStrategy
import kotlinx.coroutines.sync.Mutex
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import miharchy.sync.AddBookmark
import miharchy.sync.AddToLibrary
import miharchy.sync.BindTrack
import miharchy.sync.Change
import miharchy.sync.ChapterChange
import miharchy.sync.ChapterState
import miharchy.sync.CreateCategory
import miharchy.sync.ImportManga
import miharchy.sync.MARKER_KEY
import miharchy.sync.MangaKey
import miharchy.sync.MangaState
import miharchy.sync.MarkRead
import miharchy.sync.MarkUnread
import miharchy.sync.NOTES_KEY
import miharchy.sync.OWN_BACKUP_PREFIX
import miharchy.sync.RemoveBookmark
import miharchy.sync.RemoveFromLibrary
import miharchy.sync.SOURCE_NAMES_KEY
import miharchy.sync.SetCategories
import miharchy.sync.SetLastPage
import miharchy.sync.SetNotes
import miharchy.sync.Summary
import miharchy.sync.Health
import miharchy.sync.health
import miharchy.sync.TRACKER_NAMES
import miharchy.sync.TrackState
import miharchy.sync.UnbindTrack
import miharchy.sync.UpdateTrack
import miharchy.sync.backupName
import miharchy.sync.backupRefusal
import miharchy.sync.decodeBackup
import miharchy.sync.encodeBackup
import miharchy.sync.exportName
import miharchy.sync.gap
import miharchy.sync.holds
import miharchy.sync.isAppliedTo
import miharchy.sync.merge
import miharchy.sync.mergeSourceNames
import miharchy.sync.newestPhoneBackup
import miharchy.sync.pendingSince
import miharchy.sync.readPendingSince
import miharchy.sync.toLibrary
import miharchy.sync.writeBackup
import miharchy.sync.writeExport
import miharchy.sync.writePrivately
import java.nio.file.Files
import java.nio.file.Path
import java.sql.Connection
import java.time.Instant
import java.time.ZoneId
import kotlin.io.path.deleteIfExists
import kotlin.io.path.exists
import kotlin.io.path.isDirectory
import kotlin.io.path.isRegularFile
import kotlin.io.path.readBytes
import miharchy.sync.Library as SyncLibrary

/** What a backup carries besides the library manga, as Settings' backup rows choose. */
data class Parts(val categories: Boolean = true, val chapters: Boolean = true, val tracking: Boolean = true, val history: Boolean = true)

/**
 * The phone sync (ADR 0002) and Mihon backups on core's database (#369). sync/'s merge decides what changes; this
 * applies it with SQL in one transaction, so nothing is half applied and no restore is needed. It holds no
 * extension host and no tracker client, so a sync never contacts a source or a tracker.
 */
class Sync(
    private val db: Database,
    /** Core's own baselines and pending-since: core's library is not the one the Suwayomi helper's baselines describe. */
    private val stateDir: Path,
    /** The address the summary names, as the helper's names its server. */
    private val server: String,
    /** The trackers core has; a backup's track on any other stays out. */
    private val trackerIds: Set<Int>,
    /** Installed sources' names by id, for an export's `backupSources`. It reads the loaded list only. */
    private val installedSources: suspend () -> Map<Long, String> = { emptyMap() },
    /** Where backups go when Settings' backup folder is blank: `backups` beside the state folder, in core's data folder. */
    private val backups: Path = stateDir.resolveSibling("backups"),
    /** Each tracker's name and whether it is logged in, by id, for `backup.check`. */
    private val trackerLogins: suspend () -> Map<Int, Pair<String, Boolean>> = { emptyMap() },
) {
    // One at a time, as the helper's sync.lock: an import never runs into a sync's read of the library.
    private val lock = Mutex()

    val routes: Map<String, Route> = mapOf(
        "sync.run" to { input -> locked { run(input) } },
        "backup.export" to { input -> locked { exportTo(input) } },
        "backup.import" to { input -> locked { import(input) } },
        // These two read only, so they take no lock: the window asks for health right after a sync.
        "sync.health" to { input -> Json { encodeDefaults = true }.encodeToJsonElement(Health.serializer(), health(folder(input), stateDir, ZoneId.systemDefault())) },
        "backup.check" to { input -> check(input) },
    )

    private suspend fun locked(block: suspend () -> JsonElement): JsonElement {
        if (!lock.tryLock()) throw ApiError(Kind.invalid, "A sync is already running.")
        try {
            return block()
        } finally {
            lock.unlock()
        }
    }

    private class Outcome(val changes: List<Change>, val held: Boolean, val export: Path?, val exported: ByteArray?)

    /**
     * `{ folder?, dryRun?, apply? }` -> the helper's `Summary`. Merges the newest phone backup in and writes the
     * desktop backup for the phone in one transaction; the baselines move only after it commits.
     */
    private suspend fun run(input: JsonObject): JsonElement {
        val dryRun = input.flag("dryRun")
        val apply = input.flag("apply")
        val folder = folder(input)
        val phoneFile = newestPhoneBackup(folder)
        val phoneBytes = phoneFile?.readBytes()
        val phoneNow = phoneBytes?.let { readBackup(it, phoneFile.toString()) }
        val phoneBaseline = stateDir.resolve(PHONE_BASELINE).takeIf { it.exists() }?.let { decodeBackup(it.readBytes()) }
        val desktopBaseline = stateDir.resolve(DESKTOP_BASELINE).takeIf { it.exists() }?.let { decodeBackup(it.readBytes()) }
        val phoneUrls = (phoneNow?.backupManga.orEmpty() + phoneBaseline?.backupManga.orEmpty()).map { it.url }.toSet()
        val sources = installedSources()
        val name = exportName(Instant.now())

        val outcome = db.run { c ->
            c.transaction {
                // The snapshot also holds the phone's manga outside the library; the hold counts only the library.
                val desktopNow = phoneNow?.let { snapshot(c, phoneUrls) }
                val changes = if (phoneNow == null || desktopNow == null) emptyList()
                else merge(phoneBaseline?.toLibrary(), phoneNow.toLibrary(), desktopNow, desktopBaseline?.toLibrary())
                val held = !apply && holds(changes, desktopNow?.manga?.values?.count { it.inLibrary } ?: 0)
                if (dryRun || held) return@transaction Outcome(changes, held, null, null)
                if (phoneNow != null) apply(c, changes, phoneNow, phoneUrls)
                // The baseline too, so a library imported before names were kept gets them on its next sync.
                mergeNames(c, listOfNotNull(phoneBaseline, phoneNow).flatMap { it.backupSources })
                val exported = encodeBackup(export(c, Parts(), sources, marker = name))
                // Inside the transaction: a backup that cannot be written rolls the merge back, and the next sync retries.
                Outcome(changes, false, writeExport(folder, name, exported), exported)
            }
        }
        val exported = outcome.exported
            ?: return summary(Summary(server, folder.toString(), phoneFile?.toString(), dryRun, outcome.changes, null, emptyList(), outcome.held))

        // The undo point: a sync overrides a desktop value only while it equals this baseline, and a restore only adds.
        val desktopFile = stateDir.resolve(DESKTOP_BASELINE)
        if (desktopFile.exists()) writePrivately(stateDir.resolve("pre-sync.tachibk"), desktopFile.readBytes())
        writePrivately(desktopFile, exported)
        phoneBytes?.let { writePrivately(stateDir.resolve(PHONE_BASELINE), it) }

        val gap = (phoneNow ?: phoneBaseline)?.let { gap(it, decodeBackup(exported)) }
        // desktopBaseline is still the last desktop backup here.
        val caughtUp = phoneNow != null && desktopBaseline != null && gap(phoneNow, desktopBaseline).restorable.isEmpty()
        val since = pendingSince(readPendingSince(stateDir), gap?.restorable.orEmpty().isNotEmpty(), Instant.now(), caughtUp)
        val pending = stateDir.resolve("pending-since")
        if (since == null) pending.deleteIfExists() else writePrivately(pending, since.toString().toByteArray())
        return summary(Summary(server, folder.toString(), phoneFile?.toString(), false, outcome.changes, outcome.export.toString(), gap?.byHand.orEmpty()))
    }

    /**
     * `{ folder?, categories?, chapters?, tracking?, history? }` -> `{ file }`: a backup made by hand, never into the sync
     * folder. Without them, the folder and the parts are Settings' backup rows.
     */
    private suspend fun exportTo(input: JsonObject): JsonElement {
        val (dir, parts) = db.run { c ->
            val defaults = backupParts(c)
            (input.text("folder")?.let(Path::of) ?: backupFolder(c, backups).also { if (it == backups) Files.createDirectories(it) }) to Parts(
                input.flag("categories", defaults.categories), input.flag("chapters", defaults.chapters),
                input.flag("tracking", defaults.tracking), input.flag("history", defaults.history),
            )
        }
        return buildJsonObject { put("file", backupInto(dir, parts, backupName(Instant.now())).toString()) }
    }

    /** An automatic backup (#375), or null while a sync, an import or a backup runs: the timer tries again. Throws a refusal. */
    suspend fun autoBackup(dir: Path, parts: Parts, now: Instant): Path? {
        if (!lock.tryLock()) return null
        try {
            return backupInto(dir, parts, AUTO_BACKUP_PREFIX + backupName(now).removePrefix("${OWN_BACKUP_PREFIX}backup-"))
        } finally {
            lock.unlock()
        }
    }

    private suspend fun backupInto(dir: Path, parts: Parts, name: String): Path {
        if (!dir.isDirectory()) throw ApiError(Kind.invalid, "$dir is not a folder.")
        val sources = installedSources()
        val bytes = db.run { c ->
            backupRefusal(dir.toString(), globalMeta(c, SYNC_FOLDER_KEY)?.takeIf { it.isNotBlank() })?.let { throw ApiError(Kind.invalid, it) }
            encodeBackup(export(c, parts, sources))
        }
        return writeBackup(dir, name, bytes)
    }

    /** `{ file }` -> `{ manga }`: restores a Mihon or Suwayomi backup the way Mihon does, with no source contacted. */
    private suspend fun import(input: JsonObject): JsonElement {
        val file = input.text("file") ?: throw ApiError(Kind.invalid, "The request needs file, a backup file's path.")
        val path = Path.of(file)
        if (!path.isRegularFile()) throw ApiError(Kind.invalid, "$file is not a file.")
        val backup = readBackup(path.readBytes(), file)
        val count = db.run { c -> c.transaction { restore(c, backup) } }
        return buildJsonObject { put("manga", count) }
    }

    /**
     * `{ file }` or `{ preSync: true }` -> `{ file, missingSources, missingTrackers }`: what a restore of the file needs that
     * core lacks, as Mihon's `BackupFileValidator`. `preSync` names the library before the last sync, which a restore
     * brings back; the reply names its path, for `backup.import`.
     */
    private suspend fun check(input: JsonObject): JsonElement {
        val path = if (input.flag("preSync")) stateDir.resolve("pre-sync.tachibk").also {
            if (!it.isRegularFile()) throw ApiError(Kind.notFound, "There is no sync to undo yet.")
        } else Path.of(input.text("file") ?: throw ApiError(Kind.invalid, "The request needs file, a backup file's path."))
        if (!path.isRegularFile()) throw ApiError(Kind.invalid, "$path is not a file.")
        val backup = readBackup(path.readBytes(), path.toString())
        val installed = installedSources().keys
        val trackers = trackerLogins()
        // Mihon's rules: a source by the backup's own list, a tracker core has but is not logged in to; others stay out.
        val sources = backup.backupSources.filter { it.sourceId !in installed }.map { it.name.ifBlank { it.sourceId.toString() } }.distinct().sorted()
        val loggedOut = backup.backupManga.flatMap { m -> m.tracking.map { it.syncId } }.toSet()
            .mapNotNull { id -> trackers[id]?.takeIf { !it.second }?.first }.sorted()
        return buildJsonObject {
            put("file", path.toString())
            put("missingSources", kotlinx.serialization.json.JsonArray(sources.map(::JsonPrimitive)))
            put("missingTrackers", kotlinx.serialization.json.JsonArray(loggedOut.map(::JsonPrimitive)))
        }
    }

    private suspend fun folder(input: JsonObject): Path {
        val text = input.text("folder") ?: db.run { c -> globalMeta(c, SYNC_FOLDER_KEY) }?.takeIf { it.isNotBlank() }
            ?: throw ApiError(Kind.invalid, "No sync folder is set. Choose one in Setup or Settings.")
        return Path.of(text).also { if (!it.isDirectory()) throw ApiError(Kind.invalid, "$text is not a folder.") }
    }

    /** The library manga plus any manga the phone backup names, as the merge sees them. Trackers the merge knows only. */
    fun snapshot(c: Connection, phoneUrls: Collection<String>): SyncLibrary {
        class Row(val id: Long, val key: MangaKey, val title: String, val inLibrary: Boolean)
        val rows = c.query(
            "SELECT id, source_id, remote_url, remote_title, user_favorite_at IS NOT NULL FROM manga WHERE user_favorite_at IS NOT NULL OR ${among("remote_url")}",
            textList(phoneUrls),
        ) { Row(it.getLong(1), MangaKey(it.getLong(2), it.getString(3)), it.getString(4), it.getInt(5) == 1) }
        val ids = idList(rows.map { it.id })
        val categories = c.query(
            "SELECT mc.manga_id, ca.name FROM manga_category mc JOIN category ca ON ca.id = mc.category_id WHERE ca.id != 0 AND ${among("mc.manga_id")}", ids,
        ) { it.getLong(1) to it.getString(2) }.groupBy({ it.first }, { it.second })
        val chapters = c.query(
            "SELECT manga_id, remote_url, user_read, user_bookmark, user_last_page_read FROM chapter WHERE ${among("manga_id")}", ids,
        ) { it.getLong(1) to (it.getString(2) to ChapterState(it.getInt(3) == 1, it.getInt(4) == 1, it.getLong(5))) }.groupBy({ it.first }, { it.second })
        val tracks = c.query(
            """SELECT manga_id, tracker_id, remote_id, library_id, title, remote_url, total_chapters, last_chapter_read, status, score,
                 start_date, finish_date, private FROM manga_track WHERE ${among("manga_id")}""", ids,
        ) { r ->
            // A backup holds chapters read and score as floats, so both sides compare at float precision.
            r.getLong(1) to (r.getInt(2) to TrackState(
                r.getLong(3), r.getLong(4), r.getString(5), r.getString(6), r.getInt(7), r.getDouble(8).toFloat(), r.getInt(9),
                r.getDouble(10).toFloat(), r.getLong(11), r.getLong(12), r.getInt(13) == 1,
            ))
        }.filter { it.second.first in TRACKER_NAMES }.groupBy({ it.first }, { it.second })
        val notes = notesOf(c, ids)
        return SyncLibrary(
            manga = rows.associate { m ->
                m.key to MangaState(
                    title = m.title,
                    inLibrary = m.inLibrary,
                    categories = categories[m.id].orEmpty().toSet(),
                    chapters = chapters[m.id].orEmpty().toMap(),
                    tracks = tracks[m.id].orEmpty().toMap(),
                    notes = notes[m.id].orEmpty(),
                )
            },
            categories = c.query("SELECT name FROM category WHERE id != 0 ORDER BY `order`") { it.getString(1) },
        )
    }

    /**
     * Performs [changes] exactly, then checks every one landed; a miss throws, so the transaction rolls back and the
     * baselines stay. A chapter the desktop lacks comes from [phone], so no source is asked for it.
     */
    private fun apply(c: Connection, changes: List<Change>, phone: Backup, phoneUrls: Collection<String>) {
        val phoneManga = phone.backupManga.associateBy { MangaKey(it.source, it.url) }
        val now = System.currentTimeMillis()
        for (change in changes) {
            when (change) {
                is CreateCategory -> createCategory(c, change.name)
                // Categories, tracks and notes follow as their own changes.
                is ImportManga -> restoreManga(c, phoneManga.getValue(change.manga), null, favorite = true, withTracks = false, withNotes = false, now)
                is AddToLibrary -> c.update("UPDATE manga SET user_favorite_at = coalesce(user_favorite_at, ?) WHERE id = ?", now, mangaId(c, change.manga))
                is RemoveFromLibrary -> c.update("UPDATE manga SET user_favorite_at = NULL WHERE id = ?", mangaId(c, change.manga))
                is SetCategories -> {
                    val id = mangaId(c, change.manga)
                    c.update("DELETE FROM manga_category WHERE manga_id = ?", id)
                    c.batch(
                        "INSERT INTO manga_category (manga_id, category_id) SELECT ?, id FROM category WHERE id != 0 AND name = ?",
                        change.categories.map { listOf(id, it) },
                    )
                }
                is SetNotes -> setNotes(c, mangaId(c, change.manga), change.notes)
                is ChapterChange -> {
                    val mangaId = mangaId(c, change.manga)
                    val fromPhone = phoneManga[change.manga]
                    fromPhone?.chapters?.firstOrNull { it.url == change.chapterUrl }?.let { upsertChapters(c, mangaId, listOf(it), withState = false, now) }
                    val (column, value) = when (change) {
                        is MarkRead -> "user_read" to 1L
                        is MarkUnread -> "user_read" to 0L
                        is AddBookmark -> "user_bookmark" to 1L
                        is RemoveBookmark -> "user_bookmark" to 0L
                        is SetLastPage -> "user_last_page_read" to change.page
                    }
                    c.update("UPDATE chapter SET $column = ? WHERE manga_id = ? AND remote_url = ?", value, mangaId, change.chapterUrl)
                    if (change is MarkRead) fromPhone?.history?.filter { it.url == change.chapterUrl }?.let { restoreHistory(c, mangaId, it) }
                }
                is BindTrack -> saveTrack(c, mangaId(c, change.manga), change.tracker, change.track)
                is UpdateTrack -> saveTrack(c, mangaId(c, change.manga), change.tracker, change.track)
                is UnbindTrack -> c.update("DELETE FROM manga_track WHERE manga_id = ? AND tracker_id = ?", mangaId(c, change.manga), change.tracker)
            }
        }
        val result = snapshot(c, phoneUrls)
        val missed = changes.filterNot { it.isAppliedTo(result) }
        check(missed.isEmpty()) { "Core did not apply: $missed" }
    }

    /**
     * Mihon's restore, with no source contacted: an unknown manga comes in whole; a known one keeps its own data and
     * gains the backup's read and bookmarked chapters (OR), its higher last pages, its newer history and its tracks
     * (chapters read never lower). Categories come by name and replace a manga's only when the backup lists some.
     */
    fun restore(c: Connection, backup: Backup): Int {
        val now = System.currentTimeMillis()
        // Suwayomi's built-in Default means "no category", so a Suwayomi backup's (order 0) creates nothing (forMihon).
        val categoryIds = backup.backupCategories.filterNot { it.order == 0L && it.name == "Default" }.sortedBy { it.order }
            .associate { it.order to (categoryId(c, it.name) ?: createCategory(c, it.name)) }
        for (m in backup.backupManga) restoreManga(c, m, categoryIds, m.favorite, withTracks = true, withNotes = true, now)
        mergeNames(c, backup.backupSources)
        return backup.backupManga.size
    }

    private fun restoreManga(
        c: Connection, m: BackupManga, categoryIds: Map<Long, Long>?, favorite: Boolean, withTracks: Boolean, withNotes: Boolean, now: Long,
    ): Long {
        val known = c.query("SELECT id, user_favorite_at IS NOT NULL FROM manga WHERE source_id = ? AND remote_url = ?", m.source, m.url) {
            it.getLong(1) to (it.getInt(2) == 1)
        }.firstOrNull()
        val addedAt = m.dateAdded.takeIf { it > 0 } ?: now
        val id = if (known == null) {
            c.query(
                """INSERT INTO manga (source_id, remote_url, remote_title, remote_author, remote_artist, remote_description, remote_genre,
                     remote_status, remote_cover, remote_update_strategy, remote_memo, user_favorite_at, user_chapter_flags, user_reader_flags,
                     state_initialized) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id""",
                m.source, m.url, m.title, m.author, m.artist, m.description, m.genre.joinToString(", ").ifEmpty { null }, m.status, m.thumbnailUrl,
                m.updateStrategy.ordinal, memo(m.memo), if (favorite) addedAt else null, m.chapterFlags, m.viewer_flags ?: 0, if (m.initialized) 1 else 0,
            ) { it.getLong(1) }.single()
        } else {
            if (favorite && !known.second) c.update("UPDATE manga SET user_favorite_at = ? WHERE id = ?", addedAt, known.first)
            known.first
        }
        upsertChapters(c, id, m.chapters, withState = true, now)
        restoreHistory(c, id, m.history)
        if (categoryIds != null && m.categories.isNotEmpty()) {
            c.update("DELETE FROM manga_category WHERE manga_id = ?", id)
            c.batch("INSERT OR IGNORE INTO manga_category (manga_id, category_id) VALUES (?, ?)", m.categories.mapNotNull { categoryIds[it] }.map { listOf(id, it) })
        }
        if (withTracks) {
            for (t in m.tracking.filter { it.syncId in trackerIds }) {
                c.update(
                    """INSERT INTO manga_track (manga_id, tracker_id, remote_id, remote_url, library_id, title, last_chapter_read, total_chapters,
                         status, score, start_date, finish_date, private) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT (manga_id, tracker_id) DO UPDATE SET remote_id = excluded.remote_id, library_id = excluded.library_id,
                         last_chapter_read = max(last_chapter_read, excluded.last_chapter_read)""",
                    id, t.syncId, t.mediaId, t.trackingUrl, t.libraryId, t.title, t.lastChapterRead.toDouble(), t.totalChapters, t.status,
                    t.score.toDouble(), t.startedReadingDate, t.finishedReadingDate, if (t.private) 1 else 0,
                )
            }
        }
        // Mihon keeps the notes of a manga it already has.
        if (withNotes && known == null && m.notes.isNotEmpty()) setNotes(c, id, m.notes)
        return id
    }

    /** Inserts the chapters [id] lacks. withState also raises the read state of those it has, as Mihon's restore. */
    private fun upsertChapters(c: Connection, id: Long, chapters: List<BackupChapter>, withState: Boolean, now: Long) = c.batch(
        """INSERT INTO chapter (manga_id, remote_url, remote_name, remote_scanlator, remote_chapter_number, remote_date_upload, remote_order,
             remote_memo, user_read, user_bookmark, user_last_page_read, state_date_fetch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (manga_id, remote_url) DO UPDATE SET user_read = max(user_read, excluded.user_read),
             user_bookmark = max(user_bookmark, excluded.user_bookmark), user_last_page_read = max(user_last_page_read, excluded.user_last_page_read)""",
        chapters.map { ch ->
            // A backup's sourceOrder is Mihon's source_order, core's remote_order: the index in the source's list, newest 0.
            listOf(
                id, ch.url, ch.name, ch.scanlator, ch.chapterNumber.toDouble(), ch.dateUpload, ch.sourceOrder, memo(ch.memo),
                if (withState && ch.read) 1 else 0, if (withState && ch.bookmark) 1 else 0, if (withState) ch.lastPageRead else 0,
                ch.dateFetch.takeIf { it > 0 } ?: now,
            )
        },
    )

    private fun restoreHistory(c: Connection, id: Long, history: List<BackupHistory>) = c.batch(
        """INSERT INTO history (manga_id, chapter_id, read_at, read_duration) SELECT manga_id, id, ?, ? FROM chapter WHERE manga_id = ? AND remote_url = ?
           ON CONFLICT (chapter_id) DO UPDATE SET read_at = max(coalesce(read_at, 0), excluded.read_at), read_duration = max(read_duration, excluded.read_duration)""",
        history.map { listOf(it.lastRead, it.readDuration, id, it.url) },
    )

    private fun saveTrack(c: Connection, mangaId: Long, tracker: Int, t: TrackState) = c.update(
        """INSERT INTO manga_track (manga_id, tracker_id, remote_id, remote_url, library_id, title, last_chapter_read, total_chapters,
             status, score, start_date, finish_date, private) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (manga_id, tracker_id) DO UPDATE SET remote_id = excluded.remote_id, remote_url = excluded.remote_url,
             library_id = excluded.library_id, title = excluded.title, last_chapter_read = excluded.last_chapter_read,
             total_chapters = excluded.total_chapters, status = excluded.status, score = excluded.score,
             start_date = excluded.start_date, finish_date = excluded.finish_date, private = excluded.private""",
        mangaId, tracker, t.remoteId, t.remoteUrl, t.libraryId, t.title, t.lastChapterRead.toDouble(), t.totalChapters, t.status,
        t.score.toDouble(), t.startDate, t.finishDate, if (t.private) 1 else 0,
    )

    /**
     * The library as a Mihon backup: what Mihon's restore needs, with notes from meta and every tracker core has.
     * A desktop backup for the phone carries its own name as [marker] (ADR 0006).
     */
    fun export(c: Connection, parts: Parts, installed: Map<Long, String>, marker: String? = null): Backup {
        class Cat(val id: Long, val name: String, val order: Long, val flags: Long)
        val categories = c.query("SELECT id, name, `order`, flags FROM category WHERE id != 0 ORDER BY `order`") {
            Cat(it.getLong(1), it.getString(2), it.getLong(3), it.getLong(4))
        }
        val orderOf = categories.associate { it.id to it.order }
        val manga = c.query(
            """SELECT id, source_id, remote_url, remote_title, remote_author, remote_artist, remote_description, remote_genre, remote_status,
                 remote_cover, remote_update_strategy, remote_memo, user_favorite_at, user_chapter_flags, user_reader_flags, state_initialized
               FROM manga WHERE user_favorite_at IS NOT NULL ORDER BY id""",
        ) { r ->
            r.getLong(1) to BackupManga(
                source = r.getLong(2), url = r.getString(3), title = r.getString(4), author = r.getString(5), artist = r.getString(6),
                description = r.getString(7), genre = genres(r.getString(8)).map { (it as JsonPrimitive).content }, status = r.getInt(9),
                // A local cover string is core's own path, which means nothing on the phone (#374).
                thumbnailUrl = r.getString(10).takeIf { r.getLong(2).toString() != LOCAL_SOURCE }, dateAdded = r.getLong(13), favorite = true, chapterFlags = r.getInt(14), viewer_flags = r.getInt(15),
                updateStrategy = UpdateStrategy.entries.getOrElse(r.getInt(11)) { UpdateStrategy.ALWAYS_UPDATE },
                initialized = r.getInt(16) == 1, memo = r.getString(12).toByteArray(),
            )
        }
        val ids = idList(manga.map { it.first })
        val chapters = if (!parts.chapters) emptyMap() else c.query(
            """SELECT manga_id, remote_url, remote_name, remote_scanlator, user_read, user_bookmark, user_last_page_read, state_date_fetch,
                 remote_date_upload, remote_chapter_number, remote_order, remote_memo FROM chapter WHERE ${among("manga_id")} ORDER BY manga_id, remote_order""",
            ids,
        ) { r ->
            r.getLong(1) to BackupChapter(
                url = r.getString(2), name = r.getString(3), scanlator = r.getString(4), read = r.getInt(5) == 1, bookmark = r.getInt(6) == 1,
                lastPageRead = r.getLong(7), dateFetch = r.getLong(8), dateUpload = r.getLong(9), chapterNumber = r.getDouble(10).toFloat(),
                sourceOrder = r.getLong(11), memo = r.getString(12).toByteArray(),
            )
        }.groupBy({ it.first }, { it.second })
        val mangaCategories = if (!parts.categories) emptyMap() else c.query(
            "SELECT manga_id, category_id FROM manga_category WHERE category_id != 0 AND ${among("manga_id")}", ids,
        ) { it.getLong(1) to it.getLong(2) }.groupBy({ it.first }, { orderOf.getValue(it.second) })
        val tracks = if (!parts.tracking) emptyMap() else c.query(
            """SELECT manga_id, tracker_id, library_id, remote_id, remote_url, title, last_chapter_read, total_chapters, score, status,
                 start_date, finish_date, private FROM manga_track WHERE ${among("manga_id")} ORDER BY manga_id, tracker_id""",
            ids,
        ) { r ->
            r.getLong(1) to BackupTracking(
                syncId = r.getInt(2), libraryId = r.getLong(3), mediaId = r.getLong(4), trackingUrl = r.getString(5), title = r.getString(6),
                lastChapterRead = r.getDouble(7).toFloat(), totalChapters = r.getInt(8), score = r.getDouble(9).toFloat(), status = r.getInt(10),
                startedReadingDate = r.getLong(11), finishedReadingDate = r.getLong(12), private = r.getInt(13) == 1,
            )
        }.groupBy({ it.first }, { it.second })
        val history = if (!parts.history) emptyMap() else c.query(
            "SELECT h.manga_id, ch.remote_url, h.read_at, h.read_duration FROM history h JOIN chapter ch ON ch.id = h.chapter_id WHERE h.read_at > 0 AND ${among("h.manga_id")}",
            ids,
        ) { it.getLong(1) to BackupHistory(it.getString(2), it.getLong(3), it.getLong(4)) }.groupBy({ it.first }, { it.second })
        val notes = notesOf(c, ids)
        val stored = sourceNames(c)
        return Backup(
            backupManga = manga.map { (id, m) ->
                m.apply {
                    this.chapters = chapters[id].orEmpty()
                    this.categories = mangaCategories[id].orEmpty()
                    tracking = tracks[id].orEmpty()
                    this.history = history[id].orEmpty()
                    this.notes = notes[id].orEmpty()
                }
            },
            backupCategories = if (parts.categories) categories.map { BackupCategory(it.name, it.order, it.id, it.flags) } else emptyList(),
            backupSources = manga.map { it.second.source }.distinct().map { BackupSource(installed[it] ?: stored[it.toString()].orEmpty(), it) },
            backupPreferences = listOfNotNull(marker?.let { BackupPreference(MARKER_KEY, StringPreferenceValue(it)) }),
        )
    }

    private fun mangaId(c: Connection, key: MangaKey): Long =
        c.query("SELECT id FROM manga WHERE source_id = ? AND remote_url = ?", key.source, key.url) { it.getLong(1) }.firstOrNull()
            ?: error("Core has no manga $key")

    private fun categoryId(c: Connection, name: String): Long? = c.query("SELECT id FROM category WHERE id != 0 AND name = ?", name) { it.getLong(1) }.firstOrNull()

    /** A new category after the others, as the merge appends phone categories. */
    private fun createCategory(c: Connection, name: String): Long = c.query(
        "INSERT INTO category (name, `order`) VALUES (?, (SELECT max(`order`) + 1 FROM category)) RETURNING id", name,
    ) { it.getLong(1) }.single()

    private fun notesOf(c: Connection, ids: String): Map<Long, String> =
        c.query("SELECT owner, value FROM metas WHERE scope = 'manga' AND key = ? AND ${among("owner")}", NOTES_KEY, ids) { it.getLong(1) to it.getString(2) }.toMap()

    /** Empty notes are no meta, as the window's notes editor leaves them. */
    private fun setNotes(c: Connection, id: Long, notes: String) {
        if (notes.isEmpty()) c.update("DELETE FROM metas WHERE scope = 'manga' AND owner = ? AND key = ?", id, NOTES_KEY)
        else c.update(
            "INSERT INTO metas (scope, owner, key, value) VALUES ('manga', ?, ?, ?) ON CONFLICT (scope, owner, key) DO UPDATE SET value = excluded.value",
            id, NOTES_KEY, notes,
        )
    }

    private fun globalMeta(c: Connection, key: String): String? =
        c.query("SELECT value FROM metas WHERE scope = 'global' AND owner = 0 AND key = ?", key) { it.getString(1) }.firstOrNull()

    /** Meta `miharchy.sourceNames`, source id to name; unreadable JSON counts as none. */
    private fun sourceNames(c: Connection): Map<String, String> {
        val value = globalMeta(c, SOURCE_NAMES_KEY) ?: return emptyMap()
        val names = runCatching { Json.parseToJsonElement(value).jsonObject }.getOrNull() ?: return emptyMap()
        return names.mapNotNull { (id, name) -> (name as? JsonPrimitive)?.takeIf { it.isString }?.let { id to it.content } }.toMap()
    }

    private fun mergeNames(c: Connection, sources: List<BackupSource>) {
        val stored = sourceNames(c)
        val names = mergeSourceNames(stored, sources)
        if (names == stored) return
        c.update(
            "INSERT INTO metas (scope, owner, key, value) VALUES ('global', 0, ?, ?) ON CONFLICT (scope, owner, key) DO UPDATE SET value = excluded.value",
            SOURCE_NAMES_KEY, buildJsonObject { names.forEach { (id, name) -> put(id, name) } }.toString(),
        )
    }

    companion object {
        const val PHONE_BASELINE = "phone-baseline.tachibk"
        const val DESKTOP_BASELINE = "desktop-baseline.tachibk"
        const val SYNC_FOLDER_KEY = "miharchy.syncFolder"
    }
}

/** The helper's `--json` line, so the window reads core's reply the same way (#384). */
private fun summary(s: Summary): JsonElement = Json.encodeToJsonElement(Summary.serializer(), s)

private fun readBackup(bytes: ByteArray, name: String): Backup =
    runCatching { decodeBackup(bytes) }.getOrElse { throw ApiError(Kind.invalid, "$name is not a Mihon backup: ${it.message}") }

/** A backup's memo is Mihon's JSON as bytes; anything else counts as none. */
private fun memo(bytes: ByteArray): String = String(bytes).takeIf { runCatching { Json.parseToJsonElement(it) is JsonObject }.getOrDefault(false) } ?: "{}"

private fun JsonObject.text(k: String) = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotBlank() }
private fun JsonObject.flag(k: String, default: Boolean = false) = (this[k] as? JsonPrimitive)?.booleanOrNull ?: default
