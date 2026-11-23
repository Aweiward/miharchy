package miharchy.core

import java.sql.Connection

/**
 * Suwayomi's include rule over a category column (`include_in_update`, `include_in_download`): the INCLUDE
 * categories, or the UNSET ones when none is; and the EXCLUDE ones, which win. A manga with no category is in
 * Default (0), see [categoriesOf].
 */
fun includeRule(values: Map<Long, String>): Pair<Set<Long>, Set<Long>> =
    values.filterValues { it == "INCLUDE" }.keys.ifEmpty { values.filterValues { it == "UNSET" }.keys } to
        values.filterValues { it == "EXCLUDE" }.keys

fun categoriesOf(inCats: Map<Long, List<Long>>, manga: Long): List<Long> = inCats[manga] ?: listOf(0L)

/**
 * The chapters a refresh just [added] to [manga] that auto-download queues, oldest first; Suwayomi v2.4.2366's
 * `Chapter.downloadNewChapters`. [prevLatest] is the number of the newest chapter before the refresh, null when
 * the manga had none: a first fetch downloads nothing.
 */
fun autoDownloads(c: Connection, manga: Long, added: Collection<Long>, prevLatest: Double?): List<Long> {
    if (added.isEmpty() || prevLatest == null || setting(c, "autoDownloadNewChapters").content != "true") return emptyList()
    if (c.query("SELECT 1 FROM manga WHERE id = ? AND user_favorite_at IS NOT NULL", manga) { 1 }.isEmpty()) return emptyList()
    val (included, excluded) = includeRule(c.query("SELECT id, include_in_download FROM category") { it.getLong(1) to it.getString(2) }.toMap())
    val cats = c.query("SELECT category_id FROM manga_category WHERE manga_id = ?", manga) { it.getLong(1) }.ifEmpty { listOf(0L) }
    if (cats.any { it in excluded } || cats.none { it in included }) return emptyList()
    val unreadOld = c.query("SELECT 1 FROM chapter WHERE manga_id = ? AND user_read = 0 AND NOT ${among("id")} LIMIT 1", manga, idList(added)) { 1 }
    if (setting(c, "excludeEntryWithUnreadChapters").content == "true" && unreadOld.isNotEmpty()) return emptyList()
    // remote_order 0 is the newest, so DESC is oldest first.
    val fresh = c.query("SELECT id, remote_chapter_number, remote_scanlator FROM chapter WHERE ${among("id")} ORDER BY remote_order DESC", idList(added)) {
        Triple(it.getLong(1), it.getDouble(2), it.getString(3))
    }
    // A number below the newest one before is a re-upload; an unread number (-1) is too.
    val kept = if (setting(c, "autoDownloadIgnoreReUploads").content == "true") fresh.filter { it.second >= prevLatest && it.second >= 0 } else fresh
    // One chapter per number: the first one's scanlator, else the first. Unnumbered chapters (-1) stay apart,
    // where Suwayomi would keep only one of them.
    val scanlator = kept.firstOrNull()?.third
    return kept.groupBy { if (it.second < 0) "id${it.first}" else it.second.toString() }.values
        .map { same -> same.firstOrNull { it.third == scanlator } ?: same.first() }
        .sortedBy { kept.indexOf(it) }
        .map { it.first }
}
