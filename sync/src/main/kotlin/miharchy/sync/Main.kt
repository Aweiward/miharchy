package miharchy.sync

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.nio.file.attribute.PosixFilePermissions
import kotlin.io.path.exists
import kotlin.io.path.getLastModifiedTime
import kotlin.io.path.isRegularFile
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readBytes
import kotlin.system.exitProcess

private const val USAGE = "usage: miharchy-sync ingest --folder <sync folder> [--dry-run] [--json]"

/** Backups Miharchy writes to the sync folder start with this, so ingest never mistakes them for phone backups. */
const val OWN_BACKUP_PREFIX = "miharchy-"

val stateDir: Path = Path.of(System.getProperty("user.home"), ".local/share/miharchy/sync")

@Serializable
data class Summary(
    val backup: String,
    val dryRun: Boolean,
    val changes: List<Change>,
    val skipped: List<Skipped>,
)

fun main(args: Array<String>) {
    if (args.firstOrNull() != "ingest") usage()
    val folder = args.toList().zipWithNext().firstOrNull { it.first == "--folder" }?.second?.let(Path::of) ?: usage()
    val dryRun = "--dry-run" in args
    val asJson = "--json" in args

    val phoneFile = newestPhoneBackup(folder) ?: fail("no phone backup (*.tachibk) in $folder")
    val phoneBytes = phoneFile.readBytes()
    val phoneNow = decodeBackup(phoneBytes)
    val phoneBaseline = stateDir.resolve("phone-baseline.tachibk").takeIf { it.exists() }?.let { decodeBackup(it.readBytes()) }
    val desktopBaseline = stateDir.resolve("desktop-baseline.tachibk").takeIf { it.exists() }?.let { decodeBackup(it.readBytes()) }
    val phoneUrls = (phoneNow.backupManga + phoneBaseline?.backupManga.orEmpty()).map { it.url }.toSet()

    val desktop = Desktop(ServerConfig.load())
    val changes = merge(phoneBaseline?.toLibrary(), phoneNow.toLibrary(), desktop.snapshot(phoneUrls).library, desktopBaseline?.toLibrary())
    val skipped = if (dryRun) emptyList() else desktop.apply(changes, phoneBytes, phoneUrls)
    if (!dryRun) writePrivately(stateDir.resolve("phone-baseline.tachibk"), phoneBytes)

    val summary = Summary(phoneFile.toString(), dryRun, changes, skipped)
    println(if (asJson) Json.encodeToString(summary) else describe(summary))
}

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

fun describe(summary: Summary): String {
    val c = summary.changes
    val counts = listOf(
        c.count { it is ImportManga } to "imported %d manga",
        c.count { it is AddToLibrary } to "added %d manga to the library",
        c.count { it is RemoveFromLibrary } to "removed %d manga from the library",
        c.count { it is CreateCategory } to "created %d categories",
        c.count { it is SetCategories } to "set categories on %d manga",
        c.count { it is MarkRead } to "marked %d chapters read",
        c.count { it is MarkUnread } to "marked %d chapters unread",
        c.count { it is AddBookmark } to "bookmarked %d chapters",
        c.count { it is RemoveBookmark } to "removed %d bookmarks",
        c.count { it is SetLastPage } to "set the last page read on %d chapters",
        summary.skipped.size to "skipped %d chapters the source no longer lists",
    ).filter { it.first > 0 }.map { (n, text) -> text.format(n) }
    val verb = if (summary.dryRun) "Would apply" else "Applied"
    return "$verb phone backup ${summary.backup}\n" +
        (counts.ifEmpty { listOf("no changes") }).joinToString("\n") { "  $it" }
}

private fun usage(): Nothing = fail(USAGE)

private fun fail(message: String): Nothing {
    System.err.println(message)
    exitProcess(1)
}
