package miharchy.sync

import eu.kanade.tachiyomi.data.backup.models.Backup
import eu.kanade.tachiyomi.data.backup.models.BackupCategory
import eu.kanade.tachiyomi.data.backup.models.BackupChapter
import eu.kanade.tachiyomi.data.backup.models.BackupManga
import eu.kanade.tachiyomi.data.backup.models.BackupTracking
import kotlin.test.Test
import kotlin.test.assertEquals

private const val SOURCE = 2499283573021220255L
private val M = MangaKey(SOURCE, "/manga/m")
private val N = MangaKey(SOURCE, "/manga/n")

private fun chapter(url: String, read: Boolean = false, page: Long = 0, bookmark: Boolean = false) =
    BackupChapter(url = url, name = url, read = read, lastPageRead = page, bookmark = bookmark)

private class TestManga(val chapters: List<BackupChapter>, val favorite: Boolean, val categories: List<String>, val tracks: List<BackupTracking>, val notes: String)

private fun manga(
    key: MangaKey,
    vararg chapters: BackupChapter,
    favorite: Boolean = true,
    categories: List<String> = emptyList(),
    tracks: List<BackupTracking> = emptyList(),
    notes: String = "",
) = key to TestManga(chapters.toList(), favorite, categories, tracks, notes)

private const val MAL = 1
private const val ANILIST = 2

private fun track(tracker: Int = ANILIST, read: Float = 0F, status: Int = 1, score: Float = 0F, start: Long = 0, finish: Long = 0, remoteId: Long = 30013) =
    BackupTracking(
        syncId = tracker, libraryId = 0, mediaId = remoteId, title = "Remote $remoteId", trackingUrl = "https://anilist.co/manga/$remoteId",
        lastChapterRead = read, status = status, score = score, startedReadingDate = start, finishedReadingDate = finish,
    )

/** Builds a backup the way Mihon does (categories referenced by order) and reads it back through the real codec. */
private fun library(vararg manga: Pair<MangaKey, TestManga>, categories: List<String> = emptyList()): Library {
    val names = (categories + manga.flatMap { it.second.categories }).distinct()
    val backup = Backup(
        backupManga = manga.map { (key, m) ->
            BackupManga(
                source = key.source, url = key.url, title = key.url,
                chapters = m.chapters, favorite = m.favorite,
                categories = m.categories.map { names.indexOf(it).toLong() * 10 },
                tracking = m.tracks, notes = m.notes,
            )
        },
        backupCategories = names.mapIndexed { i, name -> BackupCategory(name, order = i.toLong() * 10) },
    )
    return decodeBackup(encodeBackup(backup)).toLibrary()
}

class MergeTest {
    @Test fun `first sync imports a manga the desktop has never seen, with its categories`() {
        val phone = library(manga(M, chapter("/c1", read = true), categories = listOf("Action")))
        assertEquals(
            listOf(CreateCategory("Action"), ImportManga(M, "/manga/m"), SetCategories(M, setOf("Action"))),
            merge(null, phone, Library.EMPTY, null),
        )
    }

    @Test fun `first sync is additive only`() {
        val phone = library(
            manga(M, chapter("/c1", page = 0), chapter("/c2", read = true, page = 7), categories = listOf("B")),
            manga(N, favorite = false),
        )
        val desktop = library(
            manga(M, chapter("/c1", read = true, page = 5), chapter("/c2"), categories = listOf("A")),
            manga(N),
        )
        assertEquals(
            listOf(CreateCategory("B"), SetCategories(M, setOf("A", "B")), MarkRead(M, "/c2"), SetLastPage(M, "/c2", 7)),
            merge(null, phone, desktop, null),
        )
    }

    @Test fun `a change on the phone only wins, even unread over read`() {
        val base = library(manga(M, chapter("/c1", read = true, page = 12)))
        val phone = library(manga(M, chapter("/c1")))
        assertEquals(listOf(MarkUnread(M, "/c1"), SetLastPage(M, "/c1", 0)), merge(base, phone, base, null))
    }

    @Test fun `a change on the desktop only is kept`() {
        val base = library(manga(M, chapter("/c1"), categories = listOf("A")))
        val desktop = library(manga(M, chapter("/c1", read = true, page = 3), categories = listOf("B")), categories = listOf("A"))
        assertEquals(emptyList(), merge(base, base, desktop, base))
    }

    @Test fun `without a desktop baseline the phone baseline stands in, so desktop edits survive`() {
        val base = library(manga(M, chapter("/c1"), chapter("/c2")))
        val phone = library(manga(M, chapter("/c1", read = true), chapter("/c2")))
        val desktop = library(manga(M, chapter("/c1"), chapter("/c2", read = true)))
        assertEquals(listOf(MarkRead(M, "/c1")), merge(base, phone, desktop, null))
    }

    @Test fun `both sides changed read state - read beats unread`() {
        val phoneBase = library(manga(M, chapter("/c1", read = true)))
        val phone = library(manga(M, chapter("/c1")))
        val desktopBase = library(manga(M, chapter("/c1")))
        val desktop = library(manga(M, chapter("/c1", read = true)))
        assertEquals(emptyList(), merge(phoneBase, phone, desktop, desktopBase))
        assertEquals(listOf(MarkRead(M, "/c1")), merge(desktopBase, desktop, phone, phoneBase))
    }

    @Test fun `a bookmark changed on the phone only wins, added or removed`() {
        val plain = library(manga(M, chapter("/c1")))
        val marked = library(manga(M, chapter("/c1", bookmark = true)))
        assertEquals(listOf(AddBookmark(M, "/c1")), merge(plain, marked, plain, plain))
        assertEquals(listOf(RemoveBookmark(M, "/c1")), merge(marked, plain, marked, marked))
    }

    @Test fun `both sides changed the bookmark - bookmarked wins`() {
        val plain = library(manga(M, chapter("/c1")))
        val marked = library(manga(M, chapter("/c1", bookmark = true)))
        assertEquals(emptyList(), merge(marked, plain, marked, plain))
        assertEquals(listOf(AddBookmark(M, "/c1")), merge(plain, marked, plain, marked))
    }

    @Test fun `both sides changed the last page - the higher value wins`() {
        val base = library(manga(M, chapter("/c1", page = 2)))
        val phone = library(manga(M, chapter("/c1", page = 5)))
        assertEquals(emptyList(), merge(base, phone, library(manga(M, chapter("/c1", page = 9))), base))
        assertEquals(listOf(SetLastPage(M, "/c1", 5)), merge(base, phone, library(manga(M, chapter("/c1", page = 4))), base))
    }

    @Test fun `both sides changed categories - union, creating unknown ones by name`() {
        val base = library(manga(M, categories = listOf("A")))
        val phone = library(manga(M, categories = listOf("B")))
        val desktop = library(manga(M, categories = listOf("A", "C")))
        assertEquals(
            listOf(CreateCategory("B"), SetCategories(M, setOf("A", "B", "C"))),
            merge(base, phone, desktop, base),
        )
    }

    @Test fun `every phone category reaches the desktop, empty ones too, in the phone's order`() {
        val phone = library(manga(M, categories = listOf("A")), categories = listOf("C", "A", "B"))
        val desktop = library(manga(M, categories = listOf("A")))
        assertEquals(listOf(CreateCategory("C"), CreateCategory("B")), merge(null, phone, desktop, null))
    }

    @Test fun `a category the desktop already has is not created again`() {
        val base = library(manga(M), manga(N, categories = listOf("A")))
        val phone = library(manga(M, categories = listOf("A")), manga(N, categories = listOf("A")))
        assertEquals(listOf(SetCategories(M, setOf("A"))), merge(base, phone, base, null))
    }

    @Test fun `a phone removal propagates when the desktop did not change the manga`() {
        val base = library(manga(M, chapter("/c1", read = true), categories = listOf("A")))
        val phone = library(manga(M, chapter("/c1", read = true), favorite = false))
        assertEquals(listOf(RemoveFromLibrary(M, "/manga/m")), merge(base, phone, base, null))
    }

    @Test fun `a phone removal does not propagate when the desktop changed the manga`() {
        val base = library(manga(M, chapter("/c1"), categories = listOf("A")))
        val phone = library(manga(M, chapter("/c1"), favorite = false))
        val desktop = library(manga(M, chapter("/c1", read = true), categories = listOf("A")))
        assertEquals(emptyList(), merge(base, phone, desktop, null))
    }

    @Test fun `a manga that dropped out of the phone backup is a removal, not an unread mark`() {
        val base = library(manga(M, chapter("/c1", read = true, page = 4)), manga(N))
        val phone = library(manga(N))
        assertEquals(listOf(RemoveFromLibrary(M, "/manga/m")), merge(base, phone, base, null))
    }

    @Test fun `a desktop removal stays unless the phone changed the manga`() {
        val base = library(manga(M, chapter("/c1")))
        val desktop = library(manga(M, chapter("/c1"), favorite = false))
        assertEquals(emptyList(), merge(base, base, desktop, base))

        val phone = library(manga(M, chapter("/c1", read = true)))
        assertEquals(listOf(AddToLibrary(M, "/manga/m"), MarkRead(M, "/c1")), merge(base, phone, desktop, base))
    }

    @Test fun `both sides removed the manga`() {
        val base = library(manga(M, chapter("/c1")))
        val removed = library(manga(M, chapter("/c1"), favorite = false))
        assertEquals(emptyList(), merge(base, removed, removed, base))
    }

    @Test fun `a chapter the desktop lacks still gets its change, for the restore to insert`() {
        val base = library(manga(M, chapter("/c1")))
        val phone = library(manga(M, chapter("/c1"), chapter("/c2", read = true, page = 3)))
        assertEquals(listOf(MarkRead(M, "/c2"), SetLastPage(M, "/c2", 3)), merge(base, phone, base, null))
    }

    @Test fun `a new unread chapter on the phone is no change`() {
        val base = library(manga(M, chapter("/c1")))
        val phone = library(manga(M, chapter("/c1"), chapter("/c2")))
        assertEquals(emptyList(), merge(base, phone, base, null))
    }

    @Test fun `a phone manga outside the library that the desktop never saw is not created`() {
        val phone = library(manga(M, chapter("/c1", read = true), favorite = false))
        assertEquals(emptyList(), merge(null, phone, Library.EMPTY, null))
    }

    @Test fun `a desktop manga outside the library gets added, not imported`() {
        val phone = library(manga(M, chapter("/c1", read = true)))
        val desktop = library(manga(M, chapter("/c1"), favorite = false))
        assertEquals(listOf(AddToLibrary(M, "/manga/m"), MarkRead(M, "/c1")), merge(null, phone, desktop, null))
    }

    @Test fun `merging is idempotent once applied`() {
        val base = library(manga(M, chapter("/c1", read = true)))
        val phone = library(manga(M, chapter("/c1"), favorite = false), manga(N, chapter("/c9", read = true)))
        val applied = library(manga(M, chapter("/c1"), favorite = false), manga(N, chapter("/c9", read = true)))
        assertEquals(emptyList(), merge(base, phone, applied, null))
    }

    @Test fun `first sync binds the phone's tracks, on a new manga and on a known one`() {
        val phone = library(manga(M, tracks = listOf(track(read = 4F))), manga(N, tracks = listOf(track(MAL, read = 2F, remoteId = 2))))
        val desktop = library(manga(N))
        assertEquals(
            listOf(ImportManga(M, "/manga/m"), BindTrack(M, ANILIST, track(read = 4F).toTrackState()), BindTrack(N, MAL, track(MAL, read = 2F, remoteId = 2).toTrackState())),
            merge(null, phone, desktop, null),
        )
    }

    @Test fun `a tracker Suwayomi does not support is ignored`() {
        val phone = library(manga(M, tracks = listOf(track(tracker = 6, read = 4F))))
        assertEquals(emptyList(), merge(null, phone, library(manga(M)), null))
    }

    @Test fun `a track changed on the phone only wins, chapters read only ever going up`() {
        val base = library(manga(M, tracks = listOf(track(read = 4F, status = 1, score = 6F))))
        val phone = library(manga(M, tracks = listOf(track(read = 7F, status = 2, score = 8F))))
        assertEquals(listOf(UpdateTrack(M, ANILIST, track(read = 7F, status = 2, score = 8F).toTrackState())), merge(base, phone, base, base))
        val lowered = library(manga(M, tracks = listOf(track(read = 1F, status = 2, score = 6F))))
        assertEquals(listOf(UpdateTrack(M, ANILIST, track(read = 4F, status = 2, score = 6F).toTrackState())), merge(base, lowered, base, base))
    }

    @Test fun `a track changed on the desktop only is kept`() {
        val base = library(manga(M, tracks = listOf(track(read = 4F))))
        val desktop = library(manga(M, tracks = listOf(track(read = 9F, status = 2))))
        assertEquals(emptyList(), merge(base, base, desktop, base))
    }

    @Test fun `both sides changed a track - most read, earliest start, latest finish, the rest from the side that read further`() {
        val base = library(manga(M, tracks = listOf(track(read = 4F, status = 1, score = 5F, start = 300))))
        val phone = library(manga(M, tracks = listOf(track(read = 6F, status = 1, score = 7F, start = 200))))
        val desktop = library(manga(M, tracks = listOf(track(read = 9F, status = 2, score = 5F, start = 300, finish = 900))))
        // The desktop read further, so its status wins; only the phone changed the score, so the phone's stands.
        assertEquals(
            listOf(UpdateTrack(M, ANILIST, track(read = 9F, status = 2, score = 7F, start = 200, finish = 900).toTrackState())),
            merge(base, phone, desktop, base),
        )
        // The phone read further but left the status alone, so the desktop's status stands.
        val behind = library(manga(M, tracks = listOf(track(read = 5F, status = 3, score = 2F, start = 300))))
        assertEquals(
            listOf(UpdateTrack(M, ANILIST, track(read = 6F, status = 3, score = 7F, start = 200).toTrackState())),
            merge(base, phone, behind, base),
        )
    }

    @Test fun `both sides bound the same tracker on first sync - merged, the phone leading on a tie`() {
        val phone = library(manga(M, tracks = listOf(track(read = 3F, status = 1, remoteId = 7))))
        val desktop = library(manga(M, tracks = listOf(track(read = 3F, status = 2, remoteId = 8))))
        assertEquals(listOf(UpdateTrack(M, ANILIST, track(read = 3F, status = 1, remoteId = 7).toTrackState())), merge(null, phone, desktop, null))
    }

    @Test fun `a phone unbind propagates when the desktop did not change the track`() {
        val base = library(manga(M, tracks = listOf(track(read = 4F), track(MAL, remoteId = 2))))
        val phone = library(manga(M, tracks = listOf(track(MAL, remoteId = 2))))
        assertEquals(listOf(UnbindTrack(M, ANILIST)), merge(base, phone, base, base))
    }

    @Test fun `an unbind on one side loses to a change on the other`() {
        val base = library(manga(M, tracks = listOf(track(read = 4F))))
        val unbound = library(manga(M))
        val raised = library(manga(M, tracks = listOf(track(read = 6F))))
        assertEquals(emptyList(), merge(base, unbound, raised, base))
        assertEquals(listOf(BindTrack(M, ANILIST, track(read = 6F).toTrackState())), merge(base, raised, unbound, base))
    }

    @Test fun `a desktop unbind survives when the phone did not change the track`() {
        val base = library(manga(M, tracks = listOf(track(read = 4F))))
        assertEquals(emptyList(), merge(base, base, library(manga(M)), base))
    }

    @Test fun `a track edit on the desktop keeps a phone removal from propagating`() {
        val base = library(manga(M, tracks = listOf(track(read = 4F))))
        val phone = library(manga(M, favorite = false, tracks = listOf(track(read = 4F))))
        val desktop = library(manga(M, tracks = listOf(track(read = 5F))))
        assertEquals(emptyList(), merge(base, phone, desktop, base))
    }

    @Test fun `a manga new to the desktop brings its notes`() {
        val phone = library(manga(M, notes = "Dropped"))
        assertEquals(listOf(ImportManga(M, "/manga/m"), SetNotes(M, "Dropped")), merge(null, phone, Library.EMPTY, null))
    }

    @Test fun `notes changed on the phone only come in, changed on the desktop only stay`() {
        val base = library(manga(M, notes = "a"))
        assertEquals(listOf(SetNotes(M, "b")), merge(base, library(manga(M, notes = "b")), base, base))
        assertEquals(listOf(SetNotes(M, "")), merge(base, library(manga(M)), base, base), "a note the phone cleared clears")
        assertEquals(emptyList(), merge(base, base, library(manga(M, notes = "c")), base))
    }

    @Test fun `notes both sides changed keep both texts, the desktop's first`() {
        val base = library(manga(M, notes = "a"))
        assertEquals(listOf(SetNotes(M, "desk\n\nphone")), merge(base, library(manga(M, notes = "phone")), library(manga(M, notes = "desk")), base))
        assertEquals(emptyList(), merge(base, library(manga(M, notes = "same")), library(manga(M, notes = "same")), base))
    }

    @Test fun `track merging is idempotent once applied`() {
        val base = library(manga(M, tracks = listOf(track(read = 4F))))
        val phone = library(manga(M, tracks = listOf(track(read = 6F, score = 8F))))
        assertEquals(emptyList(), merge(base, phone, phone, null))
    }
}
