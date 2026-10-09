package miharchy.sync

import java.time.Instant
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private val BERLIN = ZoneId.of("Europe/Berlin")
private fun at(s: String) = Instant.parse(s)

class HealthTest {
    @Test fun `a Mihon backup is dated by its name, in the phone's time zone, and any other by its file time`() {
        val fileTime = at("2026-10-09T20:00:00Z")
        assertEquals(at("2026-10-09T12:00:00Z"), phoneBackupTime("app.mihon_2026-10-09_14-00.tachibk", fileTime, BERLIN))
        assertEquals(at("2026-10-09T12:00:00Z"), phoneBackupTime("app.mihon.dev_2026-10-09_14-00.tachibk", fileTime, BERLIN))
        assertEquals(fileTime, phoneBackupTime("library.tachibk", fileTime, BERLIN))
    }

    @Test fun `pending since starts when a restore first has something to bring, and clears when it has nothing`() {
        val first = at("2026-10-06T10:00:00Z")
        val later = at("2026-10-07T10:00:00Z")
        assertEquals(first, pendingSince(previous = null, pending = true, now = first))
        assertEquals(first, pendingSince(previous = first, pending = true, now = later))
        assertNull(pendingSince(previous = first, pending = false, now = later))
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
}
