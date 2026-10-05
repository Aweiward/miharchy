package miharchy.sync

import eu.kanade.tachiyomi.data.backup.models.Backup
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

fun exportsToPrune(names: List<String>, keep: Int = KEEP_EXPORTS): List<String> =
    names.filter { it.startsWith(OWN_BACKUP_PREFIX) && it.endsWith(".tachibk") }.sorted().dropLast(keep)

/**
 * Writes [bytes] as [name] in the sync folder, then prunes older exports. The temp file does not end in
 * `.tachibk`, so neither ingest nor Mihon's file picker sees a half-written backup.
 */
fun writeExport(folder: Path, name: String, bytes: ByteArray): Path {
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
    exportsToPrune(folder.listDirectoryEntries().map { it.name }).forEach { folder.resolve(it).deleteIfExists() }
    return target
}

/**
 * Suwayomi's backup lists its built-in Default category (order 0), which means "no category". Mihon's restore
 * would create it on the phone as a user category, so it stays out; no manga refers to it. Suwayomi's backup has no
 * notes either, so each manga gets its [notes] from the desktop's meta.
 */
fun forMihon(suwayomiBackup: ByteArray, notes: Map<MangaKey, String> = emptyMap()): ByteArray {
    val backup = decodeBackup(suwayomiBackup)
    return encodeBackup(
        backup.copy(
            backupCategories = backup.backupCategories.filterNot { it.order == 0L && it.name == "Default" },
            backupManga = backup.backupManga.onEach { m -> notes[MangaKey(m.source, m.url)]?.let { m.notes = it } },
        ),
    )
}

/** A desktop state the phone keeps after restoring the export, so the user repeats it in Mihon. */
@Serializable
data class Unreachable(val change: Kind, val manga: String, val chapter: String? = null, val tracker: String? = null) {
    enum class Kind(val text: String) {
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

/**
 * What a stock Mihon restore of [export] cannot apply over the state in [phone], the newest phone backup.
 * Mihon's restore (RestoreRepositoryImpl) keeps `favorite || backup`, `read || backup`, `bookmark || backup`
 * and `max(lastPageRead, backup)`, and replaces a manga's categories only with a non-empty list. It never deletes a
 * track, and on a track the phone has it only raises chapters read. It keeps the notes of a manga the phone already
 * has (RestoreRepositoryImpl.mergeManga copies the phone's row). Measured against the phone's own backup, a
 * change stays listed until the phone has it.
 */
fun unreachable(phone: Backup, export: Backup): List<Unreachable> {
    val exported = export.backupManga.associateBy { MangaKey(it.source, it.url) }
    return phone.backupManga.filter { it.favorite }.flatMap { p ->
        val e = exported[MangaKey(p.source, p.url)]
        if (e == null || !e.favorite) return@flatMap listOf(Unreachable(Unreachable.Kind.REMOVED_FROM_LIBRARY, p.title))
        val cleared = Unreachable(Unreachable.Kind.CATEGORIES_CLEARED, p.title).takeIf { p.categories.isNotEmpty() && e.categories.isEmpty() }
        val notes = Unreachable(Unreachable.Kind.NOTES_CHANGED, p.title).takeIf { p.notes != e.notes }
        val chapters = e.chapters.associateBy { it.url }
        // Only what the user sets: the title, url and total come from the tracker, and each app names them its own way.
        fun TrackState.userSet() = listOf(remoteId, status, score, startDate, finishDate, private)
        val tracks = e.tracking.associate { it.syncId to it.toTrackState() }
        val lostTracks = p.tracking.filter { it.syncId in TRACKER_NAMES }.flatMap { pt ->
            val phoneTrack = pt.toTrackState()
            val et = tracks[pt.syncId]
            listOfNotNull(
                Unreachable.Kind.TRACK_REMOVED.takeIf { et == null },
                Unreachable.Kind.TRACK_LOWERED.takeIf { et != null && et.lastChapterRead < phoneTrack.lastChapterRead },
                Unreachable.Kind.TRACK_CHANGED.takeIf { et != null && et.userSet() != phoneTrack.userSet() },
            ).map { Unreachable(it, p.title, tracker = TRACKER_NAMES[pt.syncId]) }
        }
        listOfNotNull(cleared, notes) + lostTracks + p.chapters.flatMap { pc ->
            val ec = chapters[pc.url] ?: return@flatMap emptyList()
            listOfNotNull(
                Unreachable.Kind.MARKED_UNREAD.takeIf { pc.read && !ec.read },
                Unreachable.Kind.BOOKMARK_REMOVED.takeIf { pc.bookmark && !ec.bookmark },
                Unreachable.Kind.PAGE_LOWERED.takeIf { !pc.read && !ec.read && pc.lastPageRead > ec.lastPageRead },
            ).map { Unreachable(it, p.title, pc.name) }
        }
    }
}
