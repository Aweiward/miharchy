package miharchy.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.sql.Connection
import java.sql.ResultSet

// Rows the routes of several slices share. Core stores Mihon's epoch milliseconds; replies keep Suwayomi's units:
// uploadDate in milliseconds, lastReadAt, fetchedAt and inLibraryAt in seconds (ADR 0010).

fun seconds(ms: Long?): Long = (ms ?: 0) / 1000

/**
 * Chapters with the fields the views read, where [where] filters `ch` (chapter) and `h` (history).
 * A higher sourceOrder is newer, as on Suwayomi; Mihon's remote_order counts from the newest.
 */
fun chapterRows(c: Connection, where: String, vararg args: Any): List<JsonObject> = c.prepareStatement(
    """SELECT ch.id, ch.manga_id, ch.remote_url, ch.remote_name, ch.remote_chapter_number, ch.remote_date_upload, ch.user_read,
              ch.user_bookmark, ch.user_last_page_read, ch.remote_scanlator,
              n.total - ch.remote_order, h.read_at, ch.state_date_fetch, ch.page_count, ch.download_path
       FROM chapter ch LEFT JOIN history h ON h.chapter_id = ch.id
       JOIN (SELECT manga_id, count(*) AS total FROM chapter GROUP BY manga_id) n ON n.manga_id = ch.manga_id
       WHERE $where ORDER BY ch.manga_id, ch.remote_order""",
).use { p ->
    args.forEachIndexed { i, a -> p.setObject(i + 1, a) }
    p.executeQuery().use { r -> generateSequence { if (r.next()) chapterJson(r) else null }.toList() }
}

private fun chapterJson(r: ResultSet) = buildJsonObject {
    put("id", r.getLong(1)); put("mangaId", r.getLong(2)); put("url", r.getString(3)); put("name", r.getString(4))
    put("chapterNumber", r.getDouble(5)); put("uploadDate", r.getLong(6)); put("isRead", r.getInt(7) == 1)
    put("isBookmarked", r.getInt(8) == 1); put("lastPageRead", r.getInt(9)); put("isDownloaded", r.getString(15) != null)
    put("scanlator", r.getString(10)); put("sourceOrder", r.getInt(11))
    put("lastReadAt", seconds(r.getObject(12)?.let { r.getLong(12) })); put("fetchedAt", seconds(r.getLong(13)))
    put("pageCount", r.getInt(14))
}

/** Each manga's metas as `[{ key, value }]`, as Suwayomi's `meta { key value }`. */
fun mangaMetas(c: Connection, ids: Collection<Long>): Map<Long, JsonArray> = metasOf(c, "manga", ids)

fun metasOf(c: Connection, scope: String, ids: Collection<Long>): Map<Long, JsonArray> {
    if (ids.isEmpty()) return emptyMap()
    val out = mutableMapOf<Long, MutableList<JsonObject>>()
    c.prepareStatement("SELECT owner, key, value FROM metas WHERE scope = ? AND ${among("owner")} ORDER BY key").use { p ->
        p.setString(1, scope)
        p.setString(2, idList(ids))
        p.executeQuery().use { r ->
            while (r.next()) out.getOrPut(r.getLong(1)) { mutableListOf() } += buildJsonObject { put("key", r.getString(2)); put("value", r.getString(3)) }
        }
    }
    return ids.associateWith { JsonArray(out[it].orEmpty()) }
}

/** Each manga's category ids. Default (0) is never stored: a manga in no category is in Default. */
fun mangaCategories(c: Connection, ids: Collection<Long>): Map<Long, JsonArray> {
    if (ids.isEmpty()) return emptyMap()
    val out = mutableMapOf<Long, MutableList<JsonPrimitive>>()
    c.prepareStatement("SELECT manga_id, category_id FROM manga_category WHERE ${among("manga_id")} ORDER BY category_id").use { p ->
        p.setString(1, idList(ids))
        p.executeQuery().use { r -> while (r.next()) out.getOrPut(r.getLong(1)) { mutableListOf() } += JsonPrimitive(r.getLong(2)) }
    }
    return ids.associateWith { JsonArray(out[it].orEmpty()) }
}
