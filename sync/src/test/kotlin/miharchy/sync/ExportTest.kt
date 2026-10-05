package miharchy.sync

import eu.kanade.tachiyomi.data.backup.models.Backup
import eu.kanade.tachiyomi.data.backup.models.BackupCategory
import eu.kanade.tachiyomi.data.backup.models.BackupChapter
import eu.kanade.tachiyomi.data.backup.models.BackupManga
import eu.kanade.tachiyomi.data.backup.models.BackupTracking
import java.nio.file.Files
import java.time.Instant
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readBytes
import kotlin.io.path.writeBytes
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals

private const val SOURCE = 2499283573021220255L

private fun chapter(url: String, read: Boolean = false, bookmark: Boolean = false, page: Long = 0) =
    BackupChapter(url = url, name = "Ch $url", read = read, bookmark = bookmark, lastPageRead = page)

private fun manga(url: String, vararg chapters: BackupChapter, favorite: Boolean = true, categories: List<Long> = emptyList()) =
    BackupManga(source = SOURCE, url = url, title = "Title $url", chapters = chapters.toList(), favorite = favorite, categories = categories)

private fun backup(vararg manga: BackupManga) = Backup(manga.toList(), listOf(BackupCategory("A", order = 1)))

class ExportTest {
    @Test fun `the backup for Mihon leaves out Suwayomi's Default category and keeps the library`() {
        val real = decodeBackup(javaClass.getResource("/suwayomi-v2.3.2243.tachibk")!!.readBytes())
        val names = real.backupCategories.map { it.name }
        assertEquals("Default", real.backupCategories.single { it.order == 0L }.name)
        val mihon = decodeBackup(forMihon(encodeBackup(real)))
        assertEquals(names - "Default", mihon.backupCategories.map { it.name })
        assertEquals(real.toLibrary().manga, mihon.toLibrary().manga)
    }

    @Test fun `what a Mihon restore keeps from the phone is listed, what it raises is not`() {
        val phone = backup(
            manga(
                "/m", chapter("/read", read = true), chapter("/marked", bookmark = true), chapter("/paged", page = 9),
                chapter("/later"), chapter("/raised", page = 1),
            ),
            manga("/removed", chapter("/c", read = true), categories = listOf(1)),
            manga("/absent", chapter("/c", read = true)),
            manga("/uncategorized", categories = listOf(1)),
            manga("/phone-only-out", favorite = false),
        )
        val export = backup(
            manga(
                "/m", chapter("/read"), chapter("/marked"), chapter("/paged", page = 3),
                chapter("/later", read = true), chapter("/raised", page = 5), chapter("/desktop-only"),
            ),
            manga("/removed", chapter("/c"), favorite = false),
            manga("/uncategorized"),
            manga("/added", chapter("/c", read = true)),
        )
        assertEquals(
            listOf(
                Unreachable(Unreachable.Kind.MARKED_UNREAD, "Title /m", "Ch /read"),
                Unreachable(Unreachable.Kind.BOOKMARK_REMOVED, "Title /m", "Ch /marked"),
                Unreachable(Unreachable.Kind.PAGE_LOWERED, "Title /m", "Ch /paged"),
                Unreachable(Unreachable.Kind.REMOVED_FROM_LIBRARY, "Title /removed"),
                Unreachable(Unreachable.Kind.REMOVED_FROM_LIBRARY, "Title /absent"),
                Unreachable(Unreachable.Kind.CATEGORIES_CLEARED, "Title /uncategorized"),
            ),
            unreachable(phone, export),
        )
    }

    @Test fun `an unread mark is one entry, not also a lowered page`() {
        val phone = backup(manga("/m", chapter("/c", read = true, page = 20)))
        val export = backup(manga("/m", chapter("/c", page = 0)))
        assertEquals(listOf(Unreachable(Unreachable.Kind.MARKED_UNREAD, "Title /m", "Ch /c")), unreachable(phone, export))
    }

    @Test fun `a page on a chapter read on both sides is no loss`() {
        val phone = backup(manga("/m", chapter("/c", read = true, page = 20)))
        val export = backup(manga("/m", chapter("/c", read = true, page = 2)))
        assertEquals(emptyList(), unreachable(phone, export))
    }

    @Test fun `a track Mihon's restore cannot reach is listed, a new or raised one is not`() {
        fun track(tracker: Int, read: Float, status: Int = 1, title: String = "") =
            BackupTracking(syncId = tracker, libraryId = 0, mediaId = 7, lastChapterRead = read, status = status, title = title)
        val phone = backup(manga("/m").apply { tracking = listOf(track(1, 5F), track(2, 5F), track(3, 5F), track(4, 5F), track(7, 5F, title = "Mihon's"), track(6, 5F)) })
        val export = backup(
            manga("/m").apply { tracking = listOf(track(2, 3F), track(3, 5F, status = 2), track(4, 8F), track(5, 1F), track(7, 5F, title = "Suwayomi's")) },
        )
        assertEquals(
            listOf(
                Unreachable(Unreachable.Kind.TRACK_REMOVED, "Title /m", tracker = "MyAnimeList"),
                Unreachable(Unreachable.Kind.TRACK_LOWERED, "Title /m", tracker = "AniList"),
                Unreachable(Unreachable.Kind.TRACK_CHANGED, "Title /m", tracker = "Kitsu"),
            ),
            unreachable(phone, export),
        )
    }

    @Test fun `export names sort by time, to the second`() {
        assertEquals("miharchy-2026-10-04_07-06-05.tachibk", exportName(Instant.parse("2026-10-04T07:06:05.900Z")))
        assertEquals(
            listOf(exportName(Instant.parse("2026-10-04T07:06:05Z")), exportName(Instant.parse("2026-10-04T07:06:06Z"))),
            listOf(exportName(Instant.parse("2026-10-04T07:06:06Z")), exportName(Instant.parse("2026-10-04T07:06:05Z"))).sorted(),
        )
    }

    @Test fun `the backup for Mihon carries the desktop's notes, which Suwayomi's backup lacks`() {
        val suwayomi = encodeBackup(backup(manga("/m"), manga("/n")))
        val mihon = decodeBackup(forMihon(suwayomi, mapOf(MangaKey(SOURCE, "/m") to "Dropped")))
        assertEquals(listOf("Dropped", ""), mihon.backupManga.map { it.notes })
    }

    @Test fun `notes the phone already has are listed, since a Mihon restore keeps them`() {
        val phone = backup(manga("/m").apply { notes = "old" }, manga("/same").apply { notes = "x" })
        val export = backup(manga("/m").apply { notes = "new" }, manga("/same").apply { notes = "x" })
        assertEquals(listOf(Unreachable(Unreachable.Kind.NOTES_CHANGED, "Title /m")), unreachable(phone, export))
    }

    @Test fun `pruning keeps the newest exports and never touches phone backups`() {
        val names = listOf(
            "miharchy-2026-10-01_00-00-00.tachibk", "miharchy-2026-10-03_00-00-00.tachibk",
            "miharchy-2026-10-02_00-00-00.tachibk", "miharchy-2026-10-04_00-00-00.tachibk",
            "app.mihon_2026-09-01_00-00.tachibk", "miharchy-notes.txt",
        )
        assertEquals(
            listOf("miharchy-2026-10-01_00-00-00.tachibk", "miharchy-2026-10-02_00-00-00.tachibk"),
            exportsToPrune(names, keep = 2),
        )
        assertEquals(emptyList(), exportsToPrune(names.take(2), keep = 3))
    }

    @Test fun `an export lands whole, beside the phone backups, and old ones go`() {
        val folder = Files.createTempDirectory("sync-folder")
        folder.resolve("phone.tachibk").writeBytes(byteArrayOf(9))
        for (day in 1..4) writeExport(folder, "miharchy-2026-10-0${day}_00-00-00.tachibk", byteArrayOf(day.toByte()))
        assertEquals(
            listOf("miharchy-2026-10-02_00-00-00.tachibk", "miharchy-2026-10-03_00-00-00.tachibk", "miharchy-2026-10-04_00-00-00.tachibk", "phone.tachibk"),
            folder.listDirectoryEntries().map { it.name }.sorted(),
        )
        assertContentEquals(byteArrayOf(4), folder.resolve("miharchy-2026-10-04_00-00-00.tachibk").readBytes())
    }

    @Test fun `a backup made by hand is no phone backup, and pruning neither takes it nor counts it`() {
        val folder = Files.createTempDirectory("sync-folder")
        folder.resolve("phone.tachibk").writeBytes(byteArrayOf(9))
        val manual = writeBackup(folder, backupName(Instant.parse("2026-10-05T00:00:00Z")), byteArrayOf(7))
        assertEquals("miharchy-backup-2026-10-05_00-00-00.tachibk", manual.name)
        for (day in 1..4) writeExport(folder, "miharchy-2026-10-0${day}_00-00-00.tachibk", byteArrayOf(day.toByte()))
        assertEquals(
            listOf(
                "miharchy-2026-10-02_00-00-00.tachibk", "miharchy-2026-10-03_00-00-00.tachibk", "miharchy-2026-10-04_00-00-00.tachibk",
                "miharchy-backup-2026-10-05_00-00-00.tachibk", "phone.tachibk",
            ),
            folder.listDirectoryEntries().map { it.name }.sorted(),
        )
        assertEquals("phone.tachibk", newestPhoneBackup(folder)?.name)
    }
}
