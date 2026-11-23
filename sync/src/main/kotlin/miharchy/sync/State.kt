package miharchy.sync

import kotlinx.serialization.Serializable
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.nio.file.attribute.PosixFilePermissions
import java.time.Instant
import kotlin.io.path.exists
import kotlin.io.path.getLastModifiedTime
import kotlin.io.path.isRegularFile
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readText

/** Backups Miharchy writes to the sync folder start with this, so a sync never mistakes them for phone backups. */
const val OWN_BACKUP_PREFIX = "miharchy-"

val stateDir: Path = Path.of(System.getProperty("user.home"), ".local/share/miharchy/sync")

@Serializable
data class Summary(
    val server: String,
    val folder: String,
    /** The phone backup merged in, or null when the folder has none yet. */
    val backup: String?,
    val dryRun: Boolean,
    val changes: List<Change>,
    /** The backup written for the phone, or null on a dry run. */
    val export: String?,
    val unreachable: List<PhoneChange>,
    /** The changes look like a lost phone backup, so the sync stopped before it changed anything; --apply runs it. */
    val held: Boolean = false,
)

/** Why [folder] cannot hold a backup, or null. Settings refuses the same paths with the same words (`window/Settings.js`). */
fun backupRefusal(folder: String, syncFolder: String?): String? {
    val same = syncFolder != null && Path.of(syncFolder).toAbsolutePath().normalize() == Path.of(folder).toAbsolutePath().normalize()
    return if (same) "$folder is the sync folder. Choose another backup folder in Settings." else null
}

/** When a restore first had something to bring the phone (`pendingSince`); only a sync writes it. */
val PENDING_SINCE: Path = stateDir.resolve("pending-since")

fun readPendingSince(dir: Path = stateDir): Instant? =
    dir.resolve(PENDING_SINCE.name).takeIf { it.exists() }?.let { runCatching { Instant.parse(it.readText().trim()) }.getOrNull() }

fun newestPhoneBackup(folder: Path): Path? = folder.listDirectoryEntries("*.tachibk")
    .filter { it.isRegularFile() && !it.name.startsWith(OWN_BACKUP_PREFIX) }
    .maxByOrNull { it.getLastModifiedTime() }

/** Temp file then atomic rename, so a crash leaves either the old baseline or the new one, never half of one. */
fun writePrivately(target: Path, bytes: ByteArray) {
    Files.createDirectories(target.parent)
    Files.setPosixFilePermissions(target.parent, PosixFilePermissions.fromString("rwx------"))
    val temp = Files.createTempFile(target.parent, target.name, ".tmp") // created with mode 600
    FileChannel.open(temp, StandardOpenOption.WRITE).use {
        it.write(ByteBuffer.wrap(bytes))
        it.force(true)
    }
    Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
}
