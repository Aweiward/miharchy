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
}
