package miharchy.sync

import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Phone backups after the change that a restore would bring, with no restore, before the phone counts as behind. */
const val BEHIND_AFTER = 3 // Mihon keeps 4 automatic backups, so a higher count could never show.

private val MIHON_NAME = Regex("_(\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2})\\.tachibk$")
private val MIHON_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd_HH-mm")

/** Mihon names automatic backups `app.mihon_<local time>.tachibk`; any other phone backup goes by its file time. */
fun phoneBackupTime(name: String, fileTime: Instant, zone: ZoneId): Instant =
    MIHON_NAME.find(name)?.let { LocalDateTime.parse(it.groupValues[1], MIHON_TIME).atZone(zone).toInstant() } ?: fileTime

/** When a restore first had something to bring: kept while it still has, cleared once it has nothing. */
fun pendingSince(previous: Instant?, pending: Boolean, now: Instant): Instant? = if (pending) previous ?: now else null

fun behind(pending: Boolean, since: Instant?, phoneBackups: List<Instant>): Boolean =
    pending && since != null && phoneBackups.count { it > since } >= BEHIND_AFTER
