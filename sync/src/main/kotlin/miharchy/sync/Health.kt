package miharchy.sync

import kotlinx.serialization.Serializable
import java.nio.file.Path
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.io.path.getLastModifiedTime
import kotlin.io.path.isRegularFile
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readBytes

/** Phone backups after the change that a restore would bring, with no restore, before the phone counts as behind. */
const val BEHIND_AFTER = 3 // Mihon keeps 4 automatic backups, so a higher count could never show.

private val MIHON_NAME = Regex("_(\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2})\\.tachibk$")
private val MIHON_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd_HH-mm")

/** Mihon names automatic backups `app.mihon_<local time>.tachibk`; any other phone backup goes by its file time. */
fun phoneBackupTime(name: String, fileTime: Instant, zone: ZoneId): Instant =
    MIHON_NAME.find(name)?.let { LocalDateTime.parse(it.groupValues[1], MIHON_TIME).atZone(zone).toInstant() } ?: fileTime

/**
 * When a restore first had something to bring: kept while it still has, cleared once it has nothing. A phone that
 * [caughtUp] (its newest backup lacks nothing of the last desktop backup) ended the old wait between two syncs, so a
 * new change starts the clock again instead of counting the phone backups that came while nothing was pending.
 */
fun pendingSince(previous: Instant?, pending: Boolean, now: Instant, caughtUp: Boolean = false): Instant? =
    if (pending) previous.takeUnless { caughtUp } ?: now else null

fun behind(pending: Boolean, since: Instant?, phoneBackups: List<Instant>): Boolean =
    pending && since != null && phoneBackups.count { it > since } >= BEHIND_AFTER

/** Sync health: the phone's side of the sync, from the files alone. */
@Serializable
data class Health(
    /** The newest phone backup, or null when the folder has none. */
    val phoneBackup: String? = null,
    val phoneBackupAt: String? = null,
    /** The newest desktop backup in the sync folder, or null before the first sync. */
    val desktopBackup: String? = null,
    /** The desktop backup the phone restored last, by the newest phone backup's marker. */
    val restored: String? = null,
    /** The phone backup carries no app settings, so it cannot carry the marker either. */
    val markerMissing: Boolean = false,
    val restorable: List<PhoneChange> = emptyList(),
    val byHand: List<PhoneChange> = emptyList(),
    val pendingSince: String? = null,
    val behind: Boolean = false,
)

/** Reads only: no lock, no write, so the mark and the window can ask any time. */
fun health(folder: Path, stateDir: Path, zone: ZoneId): Health {
    val phoneFiles = folder.listDirectoryEntries("*.tachibk").filter { it.isRegularFile() && !it.name.startsWith(OWN_BACKUP_PREFIX) }
    val phoneFile = newestPhoneBackup(folder) ?: return Health(desktopBackup = newestExport(folder)?.toString())
    val phone = decodeBackup(phoneFile.readBytes())
    val desktopFile = newestExport(folder)
    val gap = desktopFile?.let { gap(phone, decodeBackup(it.readBytes())) } ?: Gap(emptyList(), emptyList())
    val since = readPendingSince(stateDir)
    val pending = gap.restorable.isNotEmpty()
    return Health(
        phoneBackup = phoneFile.toString(),
        phoneBackupAt = phoneBackupTime(phoneFile.name, phoneFile.getLastModifiedTime().toInstant(), zone).toString(),
        desktopBackup = desktopFile?.toString(),
        restored = restoredFrom(phone),
        markerMissing = phone.backupPreferences.isEmpty(),
        restorable = gap.restorable,
        byHand = gap.byHand,
        pendingSince = since?.toString(),
        behind = behind(pending, since, phoneFiles.map { phoneBackupTime(it.name, it.getLastModifiedTime().toInstant(), zone) }),
    )
}
