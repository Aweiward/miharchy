package miharchy.sync

import eu.kanade.tachiyomi.data.backup.models.Backup
import eu.kanade.tachiyomi.data.backup.models.BackupSource
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

data class MangaState(
    val title: String,
    val inLibrary: Boolean,
    val categories: Set<String>,
    val chapters: Map<String, ChapterState>,
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
            )
        },
        categories = backupCategories.sortedBy { it.order }.map { it.name },
    )
}

/** Source names by id from `backupSources`, kept so the window can name a source that is not installed. */
fun mergeSourceNames(stored: Map<String, String>, sources: List<BackupSource>): Map<String, String> =
    // Mihon names a source it never knew by its id, which says nothing.
    stored + sources.filter { it.name.isNotBlank() && it.name != it.sourceId.toString() }.associate { it.sourceId.toString() to it.name }
