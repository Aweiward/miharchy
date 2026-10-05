package miharchy.sync

import eu.kanade.tachiyomi.data.backup.models.Backup
import eu.kanade.tachiyomi.data.backup.models.BackupChapter
import eu.kanade.tachiyomi.data.backup.models.BackupManga
import eu.kanade.tachiyomi.data.backup.models.BackupTracking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

private const val SOURCE = 2499283573021220255L
private val KNOWN = MangaKey(SOURCE, "/manga/known")
private val NEW = MangaKey(SOURCE, "/manga/new")
private val IDLE = MangaKey(SOURCE, "/manga/idle")

/** Five chapters, newest first as Mihon orders them: /c0 has sourceOrder 0. */
private fun phoneManga(key: MangaKey) = BackupManga(
    source = key.source, url = key.url, title = key.url, favorite = true,
    categories = listOf(10), tracking = listOf(BackupTracking(syncId = 1, libraryId = 1)),
    chapters = (0..4).map { BackupChapter(url = "/c$it", name = "c$it", read = true, bookmark = true, lastPageRead = 9, sourceOrder = it.toLong()) },
)

private val phone = encodeBackup(Backup(listOf(phoneManga(KNOWN), phoneManga(NEW), phoneManga(IDLE))))

/** The desktop knows the two oldest chapters of KNOWN, at page 8. */
private val desktop = Library(
    mapOf(
        KNOWN to MangaState("known", inLibrary = false, categories = emptySet(), chapters = mapOf("/c3" to ChapterState(lastPageRead = 8), "/c4" to ChapterState())),
        IDLE to MangaState("idle", inLibrary = true, categories = emptySet(), chapters = emptyMap()),
    ),
)

class RestoreBackupTest {
    private val changes = listOf(
        ImportManga(NEW, "new"),
        MarkRead(KNOWN, "/c0"), AddBookmark(KNOWN, "/c0"), SetLastPage(KNOWN, "/c0", 5),
        MarkRead(KNOWN, "/c1"),
        MarkUnread(KNOWN, "/c3"), RemoveBookmark(KNOWN, "/c3"), SetLastPage(KNOWN, "/c3", 2),
    )
    private val backup = restoreBackup(phone, changes, desktop).backupManga.associateBy { MangaKey(it.source, it.url) }

    @Test fun `a never-seen manga goes in whole, in the library, without categories or tracking`() {
        val new = backup.getValue(NEW)
        assertTrue(new.favorite)
        assertEquals(phoneManga(NEW).chapters.map { it.url to it.lastPageRead }, new.chapters.map { it.url to it.lastPageRead })
        assertEquals(emptyList(), new.categories)
        assertEquals(emptyList(), new.tracking)
    }

    @Test fun `a known manga carries only its changed chapters, outside the library`() {
        val known = backup.getValue(KNOWN)
        assertFalse(known.favorite)
        assertEquals(emptyList(), known.categories)
        assertEquals(emptyList(), known.tracking)
        assertEquals(setOf(KNOWN, NEW), backup.keys)
        assertEquals(
            listOf(
                Triple(true, true, 5L), // raised: restore ORs and maxes these in
                Triple(true, false, 0L), // false and 0 leave the desktop value alone
                Triple(false, false, 2L), // lowered: apply reset these first, restore then sets the page
            ),
            known.chapters.map { Triple(it.read, it.bookmark, it.lastPageRead) },
        )
    }

    @Test fun `an inserted chapter gets the position a source refresh would give it`() {
        val known = backup.getValue(KNOWN).chapters.associateBy { it.url }
        val inserted = 2
        // Suwayomi numbers an inserted chapter `inserted - sourceOrder`; a refresh numbers it `total - phone sourceOrder`.
        assertEquals(5L, inserted - known.getValue("/c0").sourceOrder)
        assertEquals(4L, inserted - known.getValue("/c1").sourceOrder)
        assertEquals(3L, known.getValue("/c3").sourceOrder)
    }

    @Test fun `a change counts as applied only once the desktop shows it`() {
        val after = desktop.copy(
            manga = desktop.manga + (KNOWN to desktop.manga.getValue(KNOWN).copy(chapters = mapOf("/c3" to ChapterState(lastPageRead = 2)))),
            categories = listOf("A"),
        )
        assertEquals(
            listOf(true, true, false, false, false),
            listOf(SetLastPage(KNOWN, "/c3", 2), CreateCategory("A"), CreateCategory("B"), MarkRead(KNOWN, "/c0"), ImportManga(NEW, "new"))
                .map { it.isAppliedTo(after) },
        )
    }

    @Test fun `each manga carries exactly its tracks to bind or update, a track-only manga with no chapters`() {
        val bound = TrackState(remoteId = 30013, lastChapterRead = 4F)
        val updated = TrackState(remoteId = 2, lastChapterRead = 7F, status = 2)
        val tracked = restoreBackup(
            phone,
            listOf(BindTrack(IDLE, 2, bound), UpdateTrack(KNOWN, 1, updated), UnbindTrack(KNOWN, 2), MarkRead(KNOWN, "/c0")),
            desktop,
        ).backupManga.associateBy { MangaKey(it.source, it.url) }
        assertEquals(setOf(IDLE, KNOWN), tracked.keys)
        assertEquals(emptyList(), tracked.getValue(IDLE).chapters)
        assertFalse(tracked.getValue(IDLE).favorite)
        assertEquals(listOf(2 to bound), tracked.getValue(IDLE).tracking.map { it.syncId to it.toTrackState() })
        assertEquals(listOf(1 to updated), tracked.getValue(KNOWN).tracking.map { it.syncId to it.toTrackState() })
    }

    @Test fun `restore reaches a desktop track only through the entry's ids and higher chapters read`() {
        val desktopTrack = TrackState(remoteId = 1, title = "Old", lastChapterRead = 9F, status = 1)
        assertEquals(desktopTrack.copy(remoteId = 2), desktopTrack.restoredWith(TrackState(remoteId = 2, title = "New", lastChapterRead = 3F, status = 2)))
    }

    @Test fun `a track change counts as applied only once the desktop shows it`() {
        val track = TrackState(remoteId = 30013, lastChapterRead = 4F)
        val after = Library(mapOf(IDLE to MangaState("idle", true, emptySet(), emptyMap(), mapOf(2 to track))))
        assertEquals(
            listOf(true, true, false, false, true),
            listOf(BindTrack(IDLE, 2, track), UpdateTrack(IDLE, 2, track), UpdateTrack(IDLE, 2, track.copy(score = 1F)), UnbindTrack(IDLE, 2), UnbindTrack(IDLE, 1))
                .map { it.isAppliedTo(after) },
        )
    }
}
