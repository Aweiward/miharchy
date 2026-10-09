package miharchy.sync

import eu.kanade.tachiyomi.data.backup.models.Backup
import eu.kanade.tachiyomi.data.backup.models.BackupManga
import eu.kanade.tachiyomi.data.backup.models.BackupPreference
import eu.kanade.tachiyomi.data.backup.models.IntPreferenceValue
import eu.kanade.tachiyomi.data.backup.models.StringPreferenceValue
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.FileTime
import java.time.Instant
import java.time.ZoneOffset
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readBytes
import kotlin.io.path.setLastModifiedTime
import kotlin.io.path.writeBytes
import kotlin.io.path.writeText
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private val BERLIN = ZoneId.of("Europe/Berlin")
private fun at(s: String) = Instant.parse(s)

private fun manga(url: String) = BackupManga(source = 1L, url = url, title = "Title $url", favorite = true)

private fun Path.put(name: String, backup: Backup, time: String) =
    resolve(name).also { it.writeBytes(encodeBackup(backup)); it.setLastModifiedTime(FileTime.from(at(time))) }

private fun Path.contents() = listDirectoryEntries().associate { it.name to it.readBytes().toList() }

class HealthTest {
    @Test fun `a Mihon backup is dated by its name, in the phone's time zone, and any other by its file time`() {
        val fileTime = at("2026-10-09T20:00:00Z")
        assertEquals(at("2026-10-09T12:00:00Z"), phoneBackupTime("app.mihon_2026-10-09_14-00.tachibk", fileTime, BERLIN))
        assertEquals(at("2026-10-09T12:00:00Z"), phoneBackupTime("app.mihon.debug_2026-10-09_14-00.tachibk", fileTime, BERLIN))
        assertEquals(fileTime, phoneBackupTime("library.tachibk", fileTime, BERLIN))
    }

    @Test fun `pending since starts when a restore first has something to bring, and clears when it has nothing`() {
        val first = at("2026-10-06T10:00:00Z")
        val later = at("2026-10-07T10:00:00Z")
        assertEquals(first, pendingSince(previous = null, pending = true, now = first))
        assertEquals(first, pendingSince(previous = first, pending = true, now = later))
        assertNull(pendingSince(previous = first, pending = false, now = later))
    }

    @Test fun `a phone that caught up with the last desktop backup between syncs starts the clock again`() {
        val old = at("2026-10-01T10:00:00Z")
        val now = at("2026-10-05T10:00:00Z")
        assertEquals(now, pendingSince(previous = old, pending = true, now = now, caughtUp = true))
        assertEquals(old, pendingSince(previous = old, pending = true, now = now, caughtUp = false))
    }

    @Test fun `the phone is behind once three phone backups came after the change and none restored it`() {
        val since = at("2026-10-06T10:00:00Z")
        val before = at("2026-10-06T09:00:00Z")
        val two = listOf(before, at("2026-10-07T09:00:00Z"), at("2026-10-08T09:00:00Z"))
        val three = two + at("2026-10-09T09:00:00Z")
        assertFalse(behind(pending = true, since = since, phoneBackups = two))
        assertTrue(behind(pending = true, since = since, phoneBackups = three))
        assertFalse(behind(pending = false, since = since, phoneBackups = three))
        assertFalse(behind(pending = true, since = null, phoneBackups = three))
    }

    @Test fun `health reads the folder and the state dir, says the phone is behind, and changes nothing`() {
        val folder = Files.createTempDirectory("folder")
        val state = Files.createTempDirectory("state")
        val older = "miharchy-2026-10-05_10-00-00.tachibk"
        val newest = "miharchy-2026-10-06_10-00-00.tachibk"
        folder.put(older, decodeBackup(forMihon(encodeBackup(Backup(listOf(manga("/a")))), marker = older)), "2026-10-05T10:00:00Z")
        folder.put(newest, decodeBackup(forMihon(encodeBackup(Backup(listOf(manga("/a"), manga("/b")))), marker = newest)), "2026-10-06T10:00:00Z")
        // The phone restored the older desktop backup, then backed up three times without restoring the newest.
        val phone = Backup(listOf(manga("/a")), backupPreferences = listOf(BackupPreference(MARKER_KEY, StringPreferenceValue(older))))
        listOf("06", "07", "08", "09").forEach { day ->
            folder.put("app.mihon_2026-10-${day}_09-00.tachibk", phone, "2026-10-${day}T09:00:00Z")
        }
        state.resolve("pending-since").writeText("2026-10-06T10:00:00Z")
        val before = state.contents()

        assertEquals(
            Health(
                phoneBackup = folder.resolve("app.mihon_2026-10-09_09-00.tachibk").toString(),
                phoneBackupAt = "2026-10-09T09:00:00Z",
                desktopBackup = folder.resolve(newest).toString(),
                restored = older,
                markerMissing = false,
                restorable = listOf(PhoneChange(PhoneChange.Kind.ADDED_TO_LIBRARY, "Title /b")),
                byHand = emptyList(),
                pendingSince = "2026-10-06T10:00:00Z",
                behind = true,
            ),
            health(folder, state, ZoneOffset.UTC),
        )
        assertEquals(before, state.contents())
    }

    @Test fun `an empty folder is a valid answer, and a phone backup without app settings says so`() {
        val folder = Files.createTempDirectory("folder")
        val state = Files.createTempDirectory("state")
        assertEquals(Health(), health(folder, state, ZoneOffset.UTC))

        folder.put("library.tachibk", Backup(listOf(manga("/a"))), "2026-10-09T09:00:00Z")
        val h = health(folder, state, ZoneOffset.UTC)
        assertTrue(h.markerMissing)
        assertNull(h.restored)
        assertNull(h.desktopBackup)
        assertEquals("2026-10-09T09:00:00Z", h.phoneBackupAt)

        folder.put("app.mihon_2026-10-09_10-00.tachibk", Backup(listOf(manga("/a")), backupPreferences = listOf(BackupPreference("pref_x", IntPreferenceValue(1)))), "2026-10-09T10:00:00Z")
        assertFalse(health(folder, state, ZoneOffset.UTC).markerMissing)
    }
}
