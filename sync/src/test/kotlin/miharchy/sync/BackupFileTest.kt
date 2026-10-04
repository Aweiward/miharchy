package miharchy.sync

import java.nio.file.Files
import java.nio.file.attribute.FileTime
import java.nio.file.attribute.PosixFilePermissions
import kotlin.io.path.readBytes
import kotlin.io.path.writeBytes
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNull

private const val MANGADEX_EN = 2499283573021220255L

class BackupFileTest {
    private val real = javaClass.getResource("/suwayomi-v2.3.2243.tachibk")!!.readBytes()

    @Test fun `reads a backup written by Suwayomi's createBackup`() {
        val library = decodeBackup(real).toLibrary()
        val talk = library.manga.getValue(MangaKey(MANGADEX_EN, "/manga/de4b3c43-5243-4399-9fc3-68a3c0747138"))
        assertEquals("We Want to Talk About Kaguya-sama", talk.title)
        assertEquals(true, talk.inLibrary)
        assertEquals(setOf("Miharchy Test A"), talk.categories)
        assertEquals(ChapterState(read = true, lastPageRead = 8), talk.chapter("/chapter/1e81465a-f83d-4acd-9fd4-8e51fdd0f120"))
        assertEquals(ChapterState(read = false, lastPageRead = 2), talk.chapter("/chapter/bb3aed97-f303-444d-9af8-d10483be9922"))
        val kaguya = library.manga.getValue(MangaKey(MANGADEX_EN, "/manga/37f5cce0-8070-4ada-96e5-fa24b1bd4ff9"))
        assertEquals(setOf("Miharchy Test A", "Miharchy Test B"), kaguya.categories)
    }

    @Test fun `re-encoding a real backup keeps its library`() {
        assertEquals(decodeBackup(real).toLibrary(), decodeBackup(encodeBackup(decodeBackup(real))).toLibrary())
    }

    @Test fun `the newest phone backup wins and Miharchy's own backups are ignored`() {
        val folder = Files.createTempDirectory("sync-folder")
        assertNull(newestPhoneBackup(folder))
        for ((name, minute) in listOf("old.tachibk" to 1, "phone.tachibk" to 2, "${OWN_BACKUP_PREFIX}export.tachibk" to 3, "notes.txt" to 4)) {
            folder.resolve(name).writeBytes(byteArrayOf())
            Files.setLastModifiedTime(folder.resolve(name), FileTime.fromMillis(minute * 60_000L))
        }
        assertEquals("phone.tachibk", newestPhoneBackup(folder)?.fileName.toString())
    }

    @Test fun `the baseline is written private and replaced whole`() {
        val target = Files.createTempDirectory("state").resolve("sync/phone-baseline.tachibk")
        writePrivately(target, byteArrayOf(1, 2))
        writePrivately(target, byteArrayOf(3))
        assertContentEquals(byteArrayOf(3), target.readBytes())
        assertEquals("rw-------", PosixFilePermissions.toString(Files.getPosixFilePermissions(target)))
        assertEquals("rwx------", PosixFilePermissions.toString(Files.getPosixFilePermissions(target.parent)))
        assertEquals(listOf("phone-baseline.tachibk"), target.parent.toFile().list()!!.toList())
    }
}
