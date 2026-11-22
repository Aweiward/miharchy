package miharchy.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import kotlin.io.path.getLastModifiedTime
import kotlin.io.path.isRegularFile
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name

/** Automatic backups start with this; only these are pruned. The sync ignores every `miharchy-` file. */
const val AUTO_BACKUP_PREFIX = "miharchy-auto-"

/** The date of the latest [time] slot at or before [t]. */
fun slotDate(t: Instant, time: LocalTime, zone: ZoneId): LocalDate {
    val today = t.atZone(zone).toLocalDate()
    return if (today.atTime(time).atZone(zone).toInstant() <= t) today else today.minusDays(1)
}

/**
 * Whether an automatic backup is due at [now]: every [intervalDays] days at [time], as Suwayomi's schedule. A slot
 * missed while core was off runs on the next tick, and counts as that slot, so the next one stays on time. With no
 * backup yet, the first is the first slot after [since], the first time the timer saw backups on.
 */
fun backupDue(now: Instant, last: Instant?, since: Instant, intervalDays: Int, time: LocalTime, zone: ZoneId): Boolean {
    if (intervalDays <= 0) return false
    val slot = slotDate(now, time, zone)
    if (last == null) return slot.atTime(time).atZone(zone).toInstant() > since
    return slot >= slotDate(last, time, zone).plusDays(intervalDays.toLong())
}

/** Backups older than [ttlDays] (0 keeps all), by file time: Suwayomi deletes by age, not count. Only automatic ones. */
fun autoBackupsToPrune(folder: Path, ttlDays: Int, now: Instant): List<Path> {
    if (ttlDays <= 0) return emptyList()
    val cutoff = now.minus(Duration.ofDays(ttlDays.toLong()))
    return folder.listDirectoryEntries("$AUTO_BACKUP_PREFIX*.tachibk").filter { it.isRegularFile() && it.getLastModifiedTime().toInstant() < cutoff }
}

/**
 * The automatic backups (#375): Settings' interval, time, keep and include rows, into the backup folder or
 * [defaultFolder] when it is blank. Core runs them, so they run while the window is closed. [clock], [zone] and
 * [tick] are there for tests.
 */
class Backups(
    private val db: Database,
    private val sync: Sync,
    private val defaultFolder: Path,
    private val clock: () -> Instant = Instant::now,
    private val zone: () -> ZoneId = ZoneId::systemDefault,
    tick: Long = 60_000,
) : AutoCloseable {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    // Logged once per change, so a folder that stays unwritable does not log every minute.
    private var problem: String? = null

    init {
        scope.launch {
            while (true) {
                delay(tick)
                check()
            }
        }
    }

    override fun close() = scope.cancel()

    /** One tick: a backup when one is due. A failure is logged once until it changes, and the next tick tries again. */
    suspend fun check() {
        try {
            backUpIfDue()
            report(null)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            report(e.message ?: e.toString())
        }
    }

    private suspend fun backUpIfDue() {
        val now = clock()
        class Plan(val interval: Int, val time: LocalTime, val ttl: Int, val last: Instant?, val since: Instant, val folder: Path, val parts: Parts)
        val plan = db.run { c ->
            fun meta(key: String) = c.query("SELECT value FROM metas WHERE scope = 'global' AND owner = 0 AND key = ?", key) { it.getString(1) }.firstOrNull()
            val interval = setting(c, "backupInterval").content.toInt()
            if (interval <= 0) return@run null
            val since = meta(SINCE)?.toLongOrNull()?.let(Instant::ofEpochMilli) ?: now.also {
                // Kept, so a machine off at every slot still gets its first backup on a later start.
                c.update("INSERT INTO metas (scope, owner, key, value) VALUES ('global', 0, ?, ?) ON CONFLICT DO NOTHING", SINCE, it.toEpochMilli().toString())
            }
            Plan(
                interval, LocalTime.parse(setting(c, "backupTime").content), setting(c, "backupTTL").content.toInt(),
                meta(LAST)?.toLongOrNull()?.let(Instant::ofEpochMilli), since, backupFolder(c, defaultFolder), backupParts(c),
            )
        } ?: return
        if (!backupDue(now, plan.last, plan.since, plan.interval, plan.time, zone())) return
        if (plan.folder == defaultFolder) Files.createDirectories(defaultFolder)
        // Null while a sync or an import runs, or when the folder is the sync folder: the next tick tries again.
        val file = sync.autoBackup(plan.folder, plan.parts, now) ?: return
        db.run { c ->
            c.update(
                "INSERT INTO metas (scope, owner, key, value) VALUES ('global', 0, ?, ?) ON CONFLICT (scope, owner, key) DO UPDATE SET value = excluded.value",
                LAST, now.toEpochMilli().toString(),
            )
        }
        autoBackupsToPrune(plan.folder, plan.ttl, now).forEach { if (it != file) Files.deleteIfExists(it) }
    }

    private fun report(message: String?) {
        if (message != problem && message != null) System.err.println("miharchy-core: automatic backup: $message")
        problem = message
    }

    companion object {
        const val LAST = "miharchy.lastAutoBackup"
        const val SINCE = "miharchy.autoBackupSince"
    }
}
