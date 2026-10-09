package miharchy.sync

import eu.kanade.tachiyomi.data.backup.models.Backup
import eu.kanade.tachiyomi.data.backup.models.BackupPreference
import eu.kanade.tachiyomi.data.backup.models.StringPreferenceValue
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import kotlin.io.path.deleteIfExists
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name

/** How many of Miharchy's own backups stay in the sync folder. */
const val KEEP_EXPORTS = 3

// UTC, so names sort in time order across a daylight saving change.
private val EXPORT_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd_HH-mm-ss").withZone(ZoneOffset.UTC)

fun exportName(now: Instant) = "$OWN_BACKUP_PREFIX${EXPORT_TIME.format(now)}.tachibk"

/**
 * A backup made by hand. It starts with [OWN_BACKUP_PREFIX], so a sync never takes it for a phone backup, and it
 * does not match [EXPORT_NAME], so a sync never prunes it.
 */
fun backupName(now: Instant) = "${OWN_BACKUP_PREFIX}backup-${EXPORT_TIME.format(now)}.tachibk"

private val EXPORT_NAME = Regex("^$OWN_BACKUP_PREFIX\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}\\.tachibk$")

/** The newest desktop backup in the sync folder: names sort by time. */
fun newestExport(folder: Path): Path? =
    folder.listDirectoryEntries().map { it.name }.filter { EXPORT_NAME.matches(it) }.maxOrNull()?.let(folder::resolve)

fun exportsToPrune(names: List<String>, keep: Int = KEEP_EXPORTS): List<String> =
    names.filter { EXPORT_NAME.matches(it) }.sorted().dropLast(keep)

/** Writes [bytes] as [name] in the sync folder, then prunes older exports. */
fun writeExport(folder: Path, name: String, bytes: ByteArray): Path {
    val target = writeBackup(folder, name, bytes)
    exportsToPrune(folder.listDirectoryEntries().map { it.name }).forEach { folder.resolve(it).deleteIfExists() }
    return target
}

/** The temp file does not end in `.tachibk`, so neither ingest nor Mihon's file picker sees a half-written backup. */
fun writeBackup(folder: Path, name: String, bytes: ByteArray): Path {
    val target = folder.resolve(name)
    val temp = Files.createTempFile(folder, ".$name", ".tmp")
    try {
        FileChannel.open(temp, StandardOpenOption.WRITE).use {
            it.write(ByteBuffer.wrap(bytes))
            it.force(true)
        }
        Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    } finally {
        temp.deleteIfExists()
    }
    return target
}

/**
 * Suwayomi's backup lists its built-in Default category (order 0), which means "no category". Mihon's restore
 * would create it on the phone as a user category, so it stays out; no manga refers to it. Suwayomi's backup has no
 * notes either, so each manga gets its [notes] from the desktop's meta. A desktop backup carries its own file name
 * as [marker], an app preference a phone keeps once it restores the file (ADR 0006).
 */
fun forMihon(suwayomiBackup: ByteArray, notes: Map<MangaKey, String> = emptyMap(), marker: String? = null): ByteArray {
    val backup = decodeBackup(suwayomiBackup)
    return encodeBackup(
        backup.copy(
            backupCategories = backup.backupCategories.filterNot { it.order == 0L && it.name == "Default" },
            backupManga = backup.backupManga.onEach { m -> notes[MangaKey(m.source, m.url)]?.let { m.notes = it } },
        ).apply { if (marker != null) backupPreferences = listOf(BackupPreference(MARKER_KEY, StringPreferenceValue(marker))) },
    )
}

/** Never `__APP_STATE_` or `__PRIVATE_`: Mihon's backup leaves those out. Phones keep it, so the name stays. */
const val MARKER_KEY = "miharchy_backup"

/** The desktop backup the phone restored last, from the phone's own backup, or null. */
fun restoredFrom(phone: Backup): String? =
    (phone.backupPreferences.firstOrNull { it.key == MARKER_KEY }?.value as? StringPreferenceValue)?.value

/** A desktop state the phone lacks: a restore of the desktop backup brings it, or the user repeats it in Mihon. */
@Serializable
data class PhoneChange(val change: Kind, val manga: String, val chapter: String? = null, val tracker: String? = null) {
    enum class Kind(val text: String) {
        // A Mihon restore brings these.
        @SerialName("addedToLibrary") ADDED_TO_LIBRARY("added to the library"),
        @SerialName("categoriesChanged") CATEGORIES_CHANGED("categories changed"),
        @SerialName("markedRead") MARKED_READ("marked read"),
        @SerialName("bookmarked") BOOKMARKED("bookmarked"),
        @SerialName("pageRaised") PAGE_RAISED("last page read raised"),
        @SerialName("trackBound") TRACK_BOUND("track added"),
        @SerialName("trackRaised") TRACK_RAISED("chapters read raised"),
        // The user repeats these by hand.
        @SerialName("removedFromLibrary") REMOVED_FROM_LIBRARY("removed from the library"),
        @SerialName("categoriesCleared") CATEGORIES_CLEARED("taken out of every category"),
        @SerialName("markedUnread") MARKED_UNREAD("marked unread"),
        @SerialName("bookmarkRemoved") BOOKMARK_REMOVED("bookmark removed"),
        @SerialName("pageLowered") PAGE_LOWERED("last page read lowered"),
        @SerialName("trackRemoved") TRACK_REMOVED("track removed"),
        @SerialName("trackLowered") TRACK_LOWERED("chapters read lowered"),
        @SerialName("trackChanged") TRACK_CHANGED("status, score, dates or entry changed"),
        @SerialName("notesChanged") NOTES_CHANGED("notes changed"),
    }
}

/** What the phone lacks of the desktop backup: what a restore brings, and what the user repeats by hand. */
@Serializable
data class Gap(val restorable: List<PhoneChange>, val byHand: List<PhoneChange>)

/**
 * The desktop backup [export] measured against [phone], the newest phone backup, so a change stays listed until the
 * phone has it. Mihon's restore (RestoreRepositoryImpl) keeps `favorite || backup`, `read || backup`,
 * `bookmark || backup` and `max(lastPageRead, backup)`, and replaces a manga's categories only with a non-empty list.
 * It never deletes a track, and on a track the phone has it only raises chapters read. It keeps the notes of a manga
 * the phone already has (RestoreRepositoryImpl.mergeManga copies the phone's row); a manga it adds brings its own.
 */
fun gap(phone: Backup, export: Backup): Gap = Gap(restorable(phone, export), byHand(phone, export))

private fun restorable(phone: Backup, export: Backup): List<PhoneChange> {
    val onPhone = phone.backupManga.associateBy { MangaKey(it.source, it.url) }
    val phoneCategories = phone.backupCategories.associate { it.order to it.name }
    val exportCategories = export.backupCategories.associate { it.order to it.name }
    return export.backupManga.filter { it.favorite }.flatMap { e ->
        val p = onPhone[MangaKey(e.source, e.url)]
        if (p == null || !p.favorite) return@flatMap listOf(PhoneChange(PhoneChange.Kind.ADDED_TO_LIBRARY, e.title))
        val categories = PhoneChange(PhoneChange.Kind.CATEGORIES_CHANGED, e.title).takeIf {
            e.categories.isNotEmpty() &&
                e.categories.mapNotNull { exportCategories[it] }.toSet() != p.categories.mapNotNull { phoneCategories[it] }.toSet()
        }
        val tracks = p.tracking.associate { it.syncId to it.lastChapterRead }
        val gained = e.tracking.filter { it.syncId in TRACKER_NAMES }.mapNotNull { et ->
            val read = tracks[et.syncId]
            when {
                read == null -> PhoneChange.Kind.TRACK_BOUND
                et.lastChapterRead > read -> PhoneChange.Kind.TRACK_RAISED
                else -> null
            }?.let { PhoneChange(it, e.title, tracker = TRACKER_NAMES[et.syncId]) }
        }
        val chapters = p.chapters.associateBy { it.url }
        listOfNotNull(categories) + gained + e.chapters.flatMap { ec ->
            val pc = chapters[ec.url]
            listOfNotNull(
                PhoneChange.Kind.MARKED_READ.takeIf { ec.read && pc?.read != true },
                PhoneChange.Kind.BOOKMARKED.takeIf { ec.bookmark && pc?.bookmark != true },
                PhoneChange.Kind.PAGE_RAISED.takeIf { !ec.read && pc?.read != true && ec.lastPageRead > (pc?.lastPageRead ?: 0) },
            ).map { PhoneChange(it, e.title, ec.name) }
        }
    }
}

private fun byHand(phone: Backup, export: Backup): List<PhoneChange> {
    val exported = export.backupManga.associateBy { MangaKey(it.source, it.url) }
    return phone.backupManga.filter { it.favorite }.flatMap { p ->
        val e = exported[MangaKey(p.source, p.url)]
        if (e == null || !e.favorite) return@flatMap listOf(PhoneChange(PhoneChange.Kind.REMOVED_FROM_LIBRARY, p.title))
        val cleared = PhoneChange(PhoneChange.Kind.CATEGORIES_CLEARED, p.title).takeIf { p.categories.isNotEmpty() && e.categories.isEmpty() }
        val notes = PhoneChange(PhoneChange.Kind.NOTES_CHANGED, p.title).takeIf { p.notes != e.notes }
        val chapters = e.chapters.associateBy { it.url }
        // Only what the user sets: the title, url and total come from the tracker, and each app names them its own way.
        fun TrackState.userSet() = listOf(remoteId, status, score, startDate, finishDate, private)
        val tracks = e.tracking.associate { it.syncId to it.toTrackState() }
        val lostTracks = p.tracking.filter { it.syncId in TRACKER_NAMES }.flatMap { pt ->
            val phoneTrack = pt.toTrackState()
            val et = tracks[pt.syncId]
            listOfNotNull(
                PhoneChange.Kind.TRACK_REMOVED.takeIf { et == null },
                PhoneChange.Kind.TRACK_LOWERED.takeIf { et != null && et.lastChapterRead < phoneTrack.lastChapterRead },
                PhoneChange.Kind.TRACK_CHANGED.takeIf { et != null && et.userSet() != phoneTrack.userSet() },
            ).map { PhoneChange(it, p.title, tracker = TRACKER_NAMES[pt.syncId]) }
        }
        listOfNotNull(cleared, notes) + lostTracks + p.chapters.flatMap { pc ->
            val ec = chapters[pc.url] ?: return@flatMap emptyList()
            listOfNotNull(
                PhoneChange.Kind.MARKED_UNREAD.takeIf { pc.read && !ec.read },
                PhoneChange.Kind.BOOKMARK_REMOVED.takeIf { pc.bookmark && !ec.bookmark },
                PhoneChange.Kind.PAGE_LOWERED.takeIf { !pc.read && !ec.read && pc.lastPageRead > ec.lastPageRead },
            ).map { PhoneChange(it, p.title, pc.name) }
        }
    }
}
