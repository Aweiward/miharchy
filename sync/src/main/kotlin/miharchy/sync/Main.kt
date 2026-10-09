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

private const val USAGE = """usage: miharchy-sync sync [--folder <sync folder>] [--dry-run] [--apply] [--json]
       miharchy-sync check <backup file>
       miharchy-sync restore <backup file>
       miharchy-sync backup <folder>"""

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

fun main(args: Array<String>) {
    // Java takes user.home from passwd, not $HOME, so a harness that sets only HOME reaches the real baselines
    // (it overwrote them on 2026-10-08). Trusting HOME instead would break the recipes that set only user.home.
    homeMismatch(System.getenv("HOME"), System.getProperty("user.home"))?.let { fail(it) }
    when (args.firstOrNull()) {
        "sync" -> {}
        "check" -> return check(args.getOrNull(1) ?: usage())
        "restore" -> return restore(args.getOrNull(1) ?: usage())
        "backup" -> return backup(args.getOrNull(1) ?: usage())
        else -> usage()
    }
    val folderArg = args.toList().zipWithNext().firstOrNull { it.first == "--folder" }?.second
    val dryRun = "--dry-run" in args
    val apply = "--apply" in args
    val asJson = "--json" in args

    // Held until the process exits, so a sync from the popup and one from the window never interleave.
    lockState() ?: fail("A sync is already running.")
    val summary = try {
        sync(folderArg, dryRun, apply)
    } catch (e: Exception) {
        fail(e.message ?: e.toString())
    }
    println(if (asJson) Json.encodeToString(summary) else describe(summary))
}

/** Merges the newest phone backup in, then exports the desktop; the baselines move only once both landed. */
private fun sync(folderArg: String?, dryRun: Boolean, apply: Boolean): Summary {
    val config = ServerConfig.load()
    val desktop = Desktop(config)
    val folder = Path.of(folderArg ?: desktop.syncFolder() ?: fail("No sync folder is set. Choose one in Setup or Settings."))
    if (!folder.isDirectory()) fail("$folder is not a folder.")

    val phoneFile = newestPhoneBackup(folder)
    val phoneBytes = phoneFile?.readBytes()
    val phoneNow = phoneBytes?.let(::decodeBackup)
    val phoneBaseline = stateDir.resolve("phone-baseline.tachibk").takeIf { it.exists() }?.let { decodeBackup(it.readBytes()) }
    val desktopBaseline = stateDir.resolve("desktop-baseline.tachibk").takeIf { it.exists() }?.let { decodeBackup(it.readBytes()) }

    val phoneUrls = (phoneNow?.backupManga.orEmpty() + phoneBaseline?.backupManga.orEmpty()).map { it.url }.toSet()
    // The snapshot also holds the phone's manga outside the desktop library; the hold counts only the library.
    val desktopNow = phoneNow?.let { desktop.snapshot(phoneUrls).library }
    val changes = if (phoneNow == null || desktopNow == null) emptyList()
    else merge(phoneBaseline?.toLibrary(), phoneNow.toLibrary(), desktopNow, desktopBaseline?.toLibrary())
    val held = !apply && holds(changes, desktopNow?.manga?.values?.count { it.inLibrary } ?: 0)
    if (dryRun || held) return Summary(config.url, folder.toString(), phoneFile?.toString(), dryRun, changes, null, emptyList(), held)
    phoneBytes?.let { desktop.apply(changes, it, phoneUrls) }

    // The baseline too, so a library imported before names were kept gets them on its next sync.
    val storedNames = desktop.sourceNames()
    val names = mergeSourceNames(storedNames, listOfNotNull(phoneBaseline, phoneNow).flatMap { it.backupSources })
    if (names != storedNames) desktop.setSourceNames(names)

    val name = exportName(Instant.now())
    val exported = forMihon(desktop.export(), desktop.notes(), marker = name)
    val exportFile = writeExport(folder, name, exported)
    // The undo point: a sync overrides a desktop value only while it equals this baseline, and a restore only adds.
    val desktopBaselineFile = stateDir.resolve("desktop-baseline.tachibk")
    if (desktopBaselineFile.exists()) writePrivately(stateDir.resolve("pre-sync.tachibk"), desktopBaselineFile.readBytes())
    writePrivately(desktopBaselineFile, exported)
    phoneBytes?.let { writePrivately(stateDir.resolve("phone-baseline.tachibk"), it) }

    val lost = (phoneNow ?: phoneBaseline)?.let { gap(it, decodeBackup(exported)).byHand }.orEmpty()
    return Summary(config.url, folder.toString(), phoneFile?.toString(), false, changes, exportFile.toString(), lost)
}

@Serializable
data class Check(val missingSources: List<String>, val missingTrackers: List<String>)

@Serializable
data class RestoreProgress(val state: String, val mangaProgress: Int, val totalManga: Int)

private fun readBackupFile(file: String): ByteArray {
    val path = Path.of(file)
    if (!path.isRegularFile()) fail("$file is not a file.")
    val bytes = path.readBytes()
    runCatching { decodeBackup(bytes) }.onFailure { fail("$file is not a Mihon backup: ${it.message}") }
    return bytes
}

/** What the backup needs that the server lacks, as one JSON line. Reads only, so it takes no lock. */
private fun check(file: String) {
    val bytes = readBackupFile(file)
    val result = try { Desktop(ServerConfig.load()).validate(bytes) } catch (e: Exception) { fail(e.message ?: e.toString()) }
    println(Json.encodeToString(result))
}

/**
 * Restores the file into the server under the sync lock, one JSON line per progress step. The baselines stay:
 * the restore only moves the desktop library, and the next sync reads that as a desktop change (ADR 0002).
 */
private fun restore(file: String) {
    val bytes = readBackupFile(file)
    lockState() ?: fail("A sync is already running.")
    try {
        val desktop = Desktop(ServerConfig.load())
        desktop.restoreFile(bytes) { println(Json.encodeToString(it)) }
        val stored = desktop.sourceNames()
        val names = mergeSourceNames(stored, decodeBackup(bytes).backupSources)
        if (names != stored) desktop.setSourceNames(names)
    } catch (e: Exception) {
        fail(e.message ?: e.toString())
    }
}

@Serializable
data class BackupResult(val file: String)

/**
 * Writes a backup into [folder] under the sync lock, so it never reads a library a restore is halfway through.
 * Never into the sync folder: there the phone would see it beside the exports for Mihon.
 */
private fun backup(folder: String) {
    val dir = Path.of(folder)
    if (!dir.isDirectory()) fail("$folder is not a folder.")
    lockState() ?: fail("A sync is already running.")
    val file = try {
        val desktop = Desktop(ServerConfig.load())
        backupRefusal(folder, desktop.syncFolder())?.let { fail(it) }
        writeBackup(dir, backupName(Instant.now()), forMihon(desktop.export(desktop.backupFlags()), desktop.notes()))
    } catch (e: Exception) {
        fail(e.message ?: e.toString())
    }
    println(Json.encodeToString(BackupResult(file.toString())))
}

/** Why [folder] cannot hold a backup, or null. Settings refuses the same paths with the same words (`window/Settings.js`). */
fun backupRefusal(folder: String, syncFolder: String?): String? {
    val same = syncFolder != null && Path.of(syncFolder).toAbsolutePath().normalize() == Path.of(folder).toAbsolutePath().normalize()
    return if (same) "$folder is the sync folder. Choose another backup folder in Settings." else null
}

/** Why the helper refuses to run when $HOME and user.home name different folders, or null. */
fun homeMismatch(home: String?, userHome: String): String? {
    if (home.isNullOrEmpty()) return null
    fun real(p: String) = Path.of(p).let { if (it.exists()) it.toRealPath() else it.toAbsolutePath().normalize() }
    return if (real(home) == real(userHome)) null
    else "HOME is $home but Java's user.home is $userHome. A verify run sets both (qs.sh env); a normal run sets neither."
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
        c.count { it is SetNotes } to "set notes on %d manga",
    ).filter { it.first > 0 }.map { (n, text) -> text.format(n) }
    val lines = mutableListOf("Sync folder ${summary.folder}, server ${summary.server}")
    if (summary.backup == null) {
        lines += "No phone backup in the sync folder yet."
    } else {
        lines += "${if (summary.dryRun || summary.held) "Would apply" else "Applied"} phone backup ${summary.backup}"
        lines += counts.ifEmpty { listOf("no changes") }.map { "  $it" }
        if (summary.held) lines += "Held: this would change much, so the sync changed nothing. Run again with --apply to apply it."
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
