package miharchy.sync

import eu.kanade.tachiyomi.data.backup.models.Backup
import eu.kanade.tachiyomi.data.backup.models.BackupSource
import eu.kanade.tachiyomi.data.backup.models.BackupTracking
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.LongAsStringSerializer
import kotlinx.serialization.protobuf.ProtoBuf
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream

/** A manga is the same manga on both sides when its source and url match. */
@Serializable
data class MangaKey(
    // Source ids exceed 2^53, which a JSON number loses in JavaScript (the window parses --json).
    @Serializable(with = LongAsStringSerializer::class) val source: Long,
    val url: String,
)

data class ChapterState(val read: Boolean = false, val bookmark: Boolean = false, val lastPageRead: Long = 0)

/**
 * One track's values, as a backup carries them. `lastChapterRead` and `score` are floats there, and the desktop
 * holds the double of that float, so both sides compare at float precision.
 */
@Serializable
data class TrackState(
    val remoteId: Long,
    val libraryId: Long = 0,
    val title: String = "",
    val remoteUrl: String = "",
    val totalChapters: Int = 0,
    val lastChapterRead: Float = 0F,
    val status: Int = 0,
    val score: Float = 0F,
    val startDate: Long = 0,
    val finishDate: Long = 0,
    val private: Boolean = false,
)

/** Mihon's tracker ids. Suwayomi v2.3.2243 (TrackerManager.services) supports these and skips the rest on restore. */
val TRACKER_NAMES = mapOf(1 to "MyAnimeList", 2 to "AniList", 3 to "Kitsu", 4 to "Shikimori", 5 to "Bangumi", 7 to "MangaUpdates")

data class MangaState(
    val title: String,
    val inLibrary: Boolean,
    val categories: Set<String>,
    val chapters: Map<String, ChapterState>,
    /** By tracker id. */
    val tracks: Map<Int, TrackState> = emptyMap(),
    /** Mihon's notes; the desktop keeps them in manga meta [NOTES_KEY]. */
    val notes: String = "",
) {
    fun chapter(url: String) = chapters[url] ?: ChapterState()
}

/** One side's library as the merge sees it: categories by name in display order, chapters by url. */
data class Library(val manga: Map<MangaKey, MangaState>, val categories: List<String> = emptyList()) {
    companion object {
        val EMPTY = Library(emptyMap())
    }
}

fun decodeBackup(bytes: ByteArray): Backup =
    ProtoBuf.decodeFromByteArray(Backup.serializer(), GZIPInputStream(bytes.inputStream()).readBytes())

fun encodeBackup(backup: Backup): ByteArray {
    val out = ByteArrayOutputStream()
    GZIPOutputStream(out).use { it.write(ProtoBuf.encodeToByteArray(Backup.serializer(), backup)) }
    return out.toByteArray()
}

/** Mihon and Suwayomi both store a manga's categories as the categories' `order` values. */
fun Backup.toLibrary(): Library {
    val nameByOrder = backupCategories.associate { it.order to it.name }
    return Library(
        manga = backupManga.associate { m ->
            MangaKey(m.source, m.url) to MangaState(
                title = m.title,
                inLibrary = m.favorite,
                categories = m.categories.mapNotNull { nameByOrder[it] }.toSet(),
                chapters = m.chapters.associate { it.url to ChapterState(it.read, it.bookmark, it.lastPageRead) },
                tracks = m.tracking.filter { it.syncId in TRACKER_NAMES }.associate { it.syncId to it.toTrackState() },
                notes = m.notes,
            )
        },
        categories = backupCategories.sortedBy { it.order }.map { it.name },
    )
}

// Suwayomi's restore reads mediaId only, never the deprecated mediaIdInt.
fun BackupTracking.toTrackState() = TrackState(
    mediaId, libraryId, title, trackingUrl, totalChapters, lastChapterRead, status, score, startedReadingDate, finishedReadingDate, private,
)

fun TrackState.toBackup(trackerId: Int) = BackupTracking(
    syncId = trackerId, libraryId = libraryId, mediaId = remoteId, trackingUrl = remoteUrl, title = title,
    lastChapterRead = lastChapterRead, totalChapters = totalChapters, score = score, status = status,
    startedReadingDate = startDate, finishedReadingDate = finishDate, private = private,
)

/** Source names by id from `backupSources`, kept so the window can name a source that is not installed. */
fun mergeSourceNames(stored: Map<String, String>, sources: List<BackupSource>): Map<String, String> =
    // Mihon names a source it never knew by its id, which says nothing.
    stored + sources.filter { it.name.isNotBlank() && it.name != it.sourceId.toString() }.associate { it.sourceId.toString() to it.name }
