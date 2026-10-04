package miharchy.sync

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** One edit to the desktop library. The merge produces these; [Desktop.apply] performs them. */
@Serializable
sealed interface Change

@Serializable
sealed interface ChapterChange : Change {
    val manga: MangaKey
    val chapterUrl: String
}

@Serializable @SerialName("createCategory")
data class CreateCategory(val name: String) : Change

/** The desktop has never seen this manga, so it comes in whole through a restore, chapters and read state included. */
@Serializable @SerialName("importManga")
data class ImportManga(val manga: MangaKey, val title: String) : Change

@Serializable @SerialName("addToLibrary")
data class AddToLibrary(val manga: MangaKey, val title: String) : Change

@Serializable @SerialName("removeFromLibrary")
data class RemoveFromLibrary(val manga: MangaKey, val title: String) : Change

@Serializable @SerialName("setCategories")
data class SetCategories(val manga: MangaKey, val categories: Set<String>) : Change

@Serializable @SerialName("markRead")
data class MarkRead(override val manga: MangaKey, override val chapterUrl: String) : ChapterChange

@Serializable @SerialName("markUnread")
data class MarkUnread(override val manga: MangaKey, override val chapterUrl: String) : ChapterChange

@Serializable @SerialName("addBookmark")
data class AddBookmark(override val manga: MangaKey, override val chapterUrl: String) : ChapterChange

@Serializable @SerialName("removeBookmark")
data class RemoveBookmark(override val manga: MangaKey, override val chapterUrl: String) : ChapterChange

@Serializable @SerialName("setLastPage")
data class SetLastPage(override val manga: MangaKey, override val chapterUrl: String, val page: Long) : ChapterChange

private val ABSENT = MangaState(title = "", inLibrary = false, categories = emptySet(), chapters = emptyMap())

/**
 * The ADR 0002 merge, phone to desktop. Each side's changes are its current state minus its own baseline.
 *
 * No phone baseline (first sync): everything the phone has counts as a phone change, which the rules below
 * turn into additions only. No desktop baseline (no export yet): the phone baseline stands in, because after
 * the last ingest the desktop matched it, so any difference from it is a desktop edit.
 */
fun merge(phoneBaseline: Library?, phoneNow: Library, desktopNow: Library, desktopBaseline: Library?): List<Change> {
    val pBaseLib = phoneBaseline ?: Library.EMPTY
    val dBaseLib = desktopBaseline ?: pBaseLib
    val changes = mutableListOf<Change>()

    for (key in pBaseLib.manga.keys + phoneNow.manga.keys) {
        val pB = pBaseLib.manga[key] ?: ABSENT
        // A manga that dropped out of the backup was removed; its read state did not change.
        val pN = phoneNow.manga[key] ?: pB.copy(inLibrary = false)
        val dN = desktopNow.manga[key]
        val dB = dBaseLib.manga[key] ?: ABSENT
        val merged = mergeManga(pB, pN, dB, dN ?: ABSENT)

        if (dN == null) {
            if (merged.inLibrary) {
                changes += ImportManga(key, pN.title)
                if (merged.categories.isNotEmpty()) changes += SetCategories(key, merged.categories)
            }
            continue
        }
        if (merged.inLibrary != dN.inLibrary) {
            changes += if (merged.inLibrary) AddToLibrary(key, pN.title) else RemoveFromLibrary(key, dN.title)
        }
        if (merged.inLibrary && merged.categories != dN.categories) changes += SetCategories(key, merged.categories)
        for ((url, c) in merged.chapters) {
            val d = dN.chapter(url)
            if (c.read != d.read) changes += if (c.read) MarkRead(key, url) else MarkUnread(key, url)
            if (c.bookmark != d.bookmark) changes += if (c.bookmark) AddBookmark(key, url) else RemoveBookmark(key, url)
            if (c.lastPageRead != d.lastPageRead) changes += SetLastPage(key, url, c.lastPageRead)
        }
    }

    // Every phone category, even an empty one, as Mihon's restore does. New ones append in the phone's order.
    val newCategories = phoneNow.categories + changes.filterIsInstance<SetCategories>().flatMap { it.categories } - desktopNow.categories.toSet()
    return newCategories.distinct().map(::CreateCategory) + changes
}

/** Unchanged on the phone keeps the desktop value; changed on the phone only takes it; both changed resolves. */
private fun <T> pick(pB: T, pN: T, dB: T, dN: T, resolve: (T, T) -> T): T = when {
    pN == pB -> dN
    dN == dB -> pN
    else -> resolve(pN, dN)
}

/** Returns the merged state. Its chapters hold only the urls the phone knows, since only those can change. */
private fun mergeManga(pB: MangaState, pN: MangaState, dB: MangaState, dN: MangaState): MangaState {
    val inLibrary = when {
        pN.inLibrary == pB.inLibrary -> dN.inLibrary || (dB.inLibrary && pN.changedFrom(pB))
        dN.inLibrary == dB.inLibrary -> pN.inLibrary || (pB.inLibrary && dN.changedFrom(dB))
        else -> pN.inLibrary || dN.inLibrary
    }
    // A manga outside the library has no meaningful categories, so leaving the library is no category change.
    val categories = pick(
        pB.categories, if (pN.inLibrary) pN.categories else pB.categories,
        dB.categories, if (dN.inLibrary) dN.categories else dB.categories,
    ) { p, d -> p + d }
    val chapters = (pB.chapters.keys + pN.chapters.keys).associateWith { url ->
        val (cpB, cpN, cdB, cdN) = listOf(pB, pN, dB, dN).map { it.chapter(url) }
        ChapterState(
            read = pick(cpB.read, cpN.read, cdB.read, cdN.read) { p, d -> p || d },
            bookmark = pick(cpB.bookmark, cpN.bookmark, cdB.bookmark, cdN.bookmark) { p, d -> p || d },
            lastPageRead = pick(cpB.lastPageRead, cpN.lastPageRead, cdB.lastPageRead, cdN.lastPageRead, ::maxOf),
        )
    }
    return MangaState(pN.title, inLibrary, categories, chapters)
}

private fun MangaState.changedFrom(base: MangaState) =
    inLibrary != base.inLibrary ||
        categories != base.categories ||
        (chapters.keys + base.chapters.keys).any { chapter(it) != base.chapter(it) }
