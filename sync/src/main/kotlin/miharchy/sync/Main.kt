package miharchy.sync

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.channels.FileLock
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.nio.file.attribute.PosixFilePermissions
import java.time.Instant
import kotlin.io.path.exists
import kotlin.io.path.getLastModifiedTime
import kotlin.io.path.isDirectory
import kotlin.io.path.isRegularFile
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readBytes
import kotlin.system.exitProcess

private const val USAGE = "usage: miharchy-sync sync [--folder <sync folder>] [--dry-run] [--json]"

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
    val unreachable: List<Unreachable>,
)

fun main(args: Array<String>) {
    if (args.firstOrNull() != "sync") usage()
    val folderArg = args.toList().zipWithNext().firstOrNull { it.first == "--folder" }?.second
    val dryRun = "--dry-run" in args
    val asJson = "--json" in args

    // Held until the process exits, so a sync from the popup and one from the window never interleave.
    lockState() ?: fail("A sync is already running.")
    val summary = try {
        sync(folderArg, dryRun)
    } catch (e: Exception) {
        fail(e.message ?: e.toString())
    }
    println(if (asJson) Json.encodeToString(summary) else describe(summary))
}

/** Merges the newest phone backup in, then exports the desktop; the baselines move only once both landed. */
private fun sync(folderArg: String?, dryRun: Boolean): Summary {
    val config = ServerConfig.load()
    val desktop = Desktop(config)
    val folder = Path.of(folderArg ?: desktop.syncFolder() ?: fail("No sync folder is set. Choose one in Setup or Settings."))
    if (!folder.isDirectory()) fail("$folder is not a folder.")

    val phoneFile = newestPhoneBackup(folder)
    val phoneBytes = phoneFile?.readBytes()
    val phoneNow = phoneBytes?.let(::decodeBackup)
    val phoneBaseline = stateDir.resolve("phone-baseline.tachibk").takeIf { it.exists() }?.let { decodeBackup(it.readBytes()) }
    val desktopBaseline = stateDir.resolve("desktop-baseline.tachibk").takeIf { it.exists() }?.let { decodeBackup(it.readBytes()) }

    val changes = if (phoneBytes == null || phoneNow == null) emptyList() else {
        val phoneUrls = (phoneNow.backupManga + phoneBaseline?.backupManga.orEmpty()).map { it.url }.toSet()
        merge(phoneBaseline?.toLibrary(), phoneNow.toLibrary(), desktop.snapshot(phoneUrls).library, desktopBaseline?.toLibrary())
            .also { if (!dryRun) desktop.apply(it, phoneBytes, phoneUrls) }
    }
    if (dryRun) return Summary(config.url, folder.toString(), phoneFile?.toString(), true, changes, null, emptyList())

    // The baseline too, so a library imported before names were kept gets them on its next sync.
    val storedNames = desktop.sourceNames()
    val names = mergeSourceNames(storedNames, listOfNotNull(phoneBaseline, phoneNow).flatMap { it.backupSources })
    if (names != storedNames) desktop.setSourceNames(names)

    val exported = forMihon(desktop.export())
    val exportFile = writeExport(folder, exportName(Instant.now()), exported)
    writePrivately(stateDir.resolve("desktop-baseline.tachibk"), exported)
    phoneBytes?.let { writePrivately(stateDir.resolve("phone-baseline.tachibk"), it) }

    val lost = (phoneNow ?: phoneBaseline)?.let { unreachable(it, decodeBackup(exported)) }.orEmpty()
    return Summary(config.url, folder.toString(), phoneFile?.toString(), false, changes, exportFile.toString(), lost)
}

// Reachable for the whole run: a collected channel closes its file, which drops the lock.
private var heldLock: FileLock? = null

/** Null while another process holds the lock. The OS drops it when this process exits, even on a crash. */
fun lockState(): FileLock? {
    Files.createDirectories(stateDir)
    Files.setPosixFilePermissions(stateDir, PosixFilePermissions.fromString("rwx------"))
    val channel = FileChannel.open(stateDir.resolve("sync.lock"), StandardOpenOption.CREATE, StandardOpenOption.WRITE)
    heldLock = channel.tryLock() ?: return null.also { channel.close() }
    return heldLock
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
        c.count { it is BindTrack } to "bound %d tracks",
        c.count { it is UpdateTrack } to "updated %d tracks",
        c.count { it is UnbindTrack } to "unbound %d tracks",
    ).filter { it.first > 0 }.map { (n, text) -> text.format(n) }
    val lines = mutableListOf("Sync folder ${summary.folder}, server ${summary.server}")
    if (summary.backup == null) {
        lines += "No phone backup in the sync folder yet."
    } else {
        lines += "${if (summary.dryRun) "Would apply" else "Applied"} phone backup ${summary.backup}"
        lines += counts.ifEmpty { listOf("no changes") }.map { "  $it" }
    }
    summary.export?.let { lines += "Wrote $it. Restore it in Mihon to bring the desktop's changes to the phone." }
    if (summary.unreachable.isNotEmpty()) {
        lines += "A restore in Mihon cannot apply these. Repeat them on the phone:"
        lines += summary.unreachable.map { u -> "  ${u.manga}${(u.chapter ?: u.tracker)?.let { ", $it" }.orEmpty()}: ${u.change.text}" }
    }
    return lines.joinToString("\n")
}

private fun usage(): Nothing = fail(USAGE)

private fun fail(message: String): Nothing {
    System.err.println(message)
    exitProcess(1)
}
