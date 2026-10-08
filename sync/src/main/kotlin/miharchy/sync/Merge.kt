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

/** The desktop's notes on this manga become [notes]. */
@Serializable @SerialName("setNotes")
data class SetNotes(val manga: MangaKey, val notes: String) : Change

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

@Serializable
sealed interface TrackChange : Change {
    val manga: MangaKey
    val tracker: Int
}

/** The desktop has no track on this tracker yet; the restore inserts this one. */
@Serializable @SerialName("bindTrack")
data class BindTrack(override val manga: MangaKey, override val tracker: Int, val track: TrackState) : TrackChange

/** The desktop's track on this tracker becomes this one, with chapters read never lower than it was. */
@Serializable @SerialName("updateTrack")
data class UpdateTrack(override val manga: MangaKey, override val tracker: Int, val track: TrackState) : TrackChange

/** Removes the desktop's track only; the entry on the tracker stays. */
@Serializable @SerialName("unbindTrack")
data class UnbindTrack(override val manga: MangaKey, override val tracker: Int) : TrackChange

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
                changes += merged.tracks.map { (id, t) -> BindTrack(key, id, t) }
                if (merged.notes.isNotEmpty()) changes += SetNotes(key, merged.notes)
            }
            continue
        }
        if (merged.notes != dN.notes) changes += SetNotes(key, merged.notes)
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
        for (id in (merged.tracks.keys + dN.tracks.keys).sorted()) {
            val t = merged.tracks[id]
            val d = dN.tracks[id]
            if (t != d) changes += if (t == null) UnbindTrack(key, id) else if (d == null) BindTrack(key, id, t) else UpdateTrack(key, id, t)
        }
    }

    // Every phone category, even an empty one, as Mihon's restore does. New ones append in the phone's order.
    val newCategories = phoneNow.categories + changes.filterIsInstance<SetCategories>().flatMap { it.categories } - desktopNow.categories.toSet()
    return newCategories.distinct().map(::CreateCategory) + changes
}

/** Fewer removals never hold, so pruning a small library goes through. */
const val HOLD_REMOVALS = 5
/** Removals hold only from this share of the library, so a big library's cleanup goes through. */
const val HOLD_REMOVAL_PERCENT = 10
/** A backup made with chapters off drops read state by the hundred; a real phone session marks a few unread. */
const val HOLD_UNREAD = 50

/**
 * True when [changes] look like a lost or partial phone backup (a fresh Mihon, another phone) more than like edits:
 * the merge reads a manga missing from the backup as removed and a missing chapter as unread.
 */
fun holds(changes: List<Change>, librarySize: Int): Boolean {
    val removals = changes.count { it is RemoveFromLibrary }
    return (removals >= HOLD_REMOVALS && removals * 100 >= librarySize * HOLD_REMOVAL_PERCENT) ||
        changes.count { it is MarkUnread } >= HOLD_UNREAD
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
    val tracks = (pB.tracks.keys + pN.tracks.keys + dB.tracks.keys + dN.tracks.keys).mapNotNull { id ->
        val tdN = dN.tracks[id]
        val t = mergeTrack(pB.tracks[id], pN.tracks[id], dB.tracks[id], tdN) ?: return@mapNotNull null
        // Chapters read on a desktop track never go down, as Suwayomi's restore and Mihon's both keep the higher value.
        id to if (tdN != null && tdN.lastChapterRead > t.lastChapterRead) t.copy(lastChapterRead = tdN.lastChapterRead) else t
    }.toMap()
    // Both sides edited the notes: neither text is lost, the desktop's first.
    val notes = pick(pB.notes, pN.notes, dB.notes, dN.notes) { p, d -> listOf(d, p).filter { it.isNotBlank() }.distinct().joinToString("\n\n") }
    return MangaState(pN.title, inLibrary, categories, chapters, tracks, notes)
}

/**
 * Null is no track. An unbind on one side loses to a change on the other, as a library removal does. Both changed:
 * the higher chapters read, the earliest start, the latest finish, and every other field from the side that read
 * further (the phone on a tie). The tracker entry's own fields move together, so one side's id never gets the
 * other's url.
 */
private fun mergeTrack(pB: TrackState?, pN: TrackState?, dB: TrackState?, dN: TrackState?): TrackState? {
    if (pN == pB) return dN
    if (dN == dB) return pN
    if (pN == null || dN == null) return pN ?: dN
    val lead = if (dN.lastChapterRead > pN.lastChapterRead) dN else pN
    fun <T> field(get: (TrackState) -> T, resolve: (T, T) -> T = { _, _ -> get(lead) }): T =
        pick(pB?.let(get), get(pN), dB?.let(get), get(dN)) { p, d -> resolve(p!!, d!!) }!!
    fun TrackState.entry() = TrackState(remoteId, libraryId, title, remoteUrl, totalChapters)
    return field({ it.entry() }).copy(
        lastChapterRead = field({ it.lastChapterRead }, ::maxOf),
        status = field({ it.status }),
        score = field({ it.score }),
        startDate = field({ it.startDate }) { p, d -> listOf(p, d).filter { it > 0 }.minOrNull() ?: 0 },
        finishDate = field({ it.finishDate }, ::maxOf),
        private = field({ it.private }),
    )
}

private fun MangaState.changedFrom(base: MangaState) =
    inLibrary != base.inLibrary ||
        categories != base.categories ||
        tracks != base.tracks ||
        notes != base.notes ||
        (chapters.keys + base.chapters.keys).any { chapter(it) != base.chapter(it) }
