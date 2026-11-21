package miharchy.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.sql.Connection

private val INCLUDE = setOf("UNSET", "INCLUDE", "EXCLUDE")
private val SCOPES = setOf("global", "manga", "category")

/**
 * The library state (#366): which manga are in the library, categories and their order, read, bookmark and last
 * page per chapter, History, and metas. Lists are plain arrays and counts are `<name>Count` (ADR 0010).
 */
class Library(private val db: Database, private val extensions: Extensions) {
    val routes: Map<String, Route> = mapOf(
        "library.list" to { _ -> list() },
        "manga.update" to { input -> updateMangas(input) },
        "chapter.update" to { input -> updateChapters(input) },
        "category.list" to { _ -> buildJsonObject { put("categories", JsonArray(db.run(::categories))) } },
        "category.create" to { input -> buildJsonObject { put("category", createCategory(input.string("name"))) } },
        "category.update" to { input -> buildJsonObject { put("category", updateCategory(input)) } },
        "category.delete" to { input -> buildJsonObject { put("category", deleteCategory(input.long("id"))) } },
        "category.reorder" to { input -> buildJsonObject { put("categories", JsonArray(reorder(input.long("id"), input.long("position").toInt()))) } },
        "meta.get" to { input -> buildJsonObject { put("metas", JsonArray(getMetas(input))) } },
        "meta.set" to { input -> buildJsonObject { put("metas", JsonArray(setMetas(input))) } },
        "meta.delete" to { input -> buildJsonObject { put("deleted", deleteMetas(input)) } },
        "history.list" to { input -> history(input) },
    )

    /** The fields `Model.fromResponse`, `LibraryCheck` and `Migrate` read, for every manga in the library. */
    private suspend fun list(): JsonObject {
        val sources = extensions.sources().associateBy { it["id"]!!.jsonPrimitive.content }
        return db.run { c ->
            val rows = c.prepareStatement(
                """SELECT m.id, m.remote_title, m.remote_author, m.remote_artist, m.remote_genre, m.remote_status, m.remote_cover,
                          m.source_id, m.user_favorite_at, m.remote_update_strategy, m.state_chapter_last_update,
                          count(ch.id), coalesce(sum(ch.user_read = 0), 0), coalesce(sum(ch.user_bookmark = 1), 0),
                          max(h.read_at), max(ch.remote_date_upload), max(ch.state_date_fetch)
                   FROM manga m LEFT JOIN chapter ch ON ch.manga_id = m.id LEFT JOIN history h ON h.chapter_id = ch.id
                   WHERE m.user_favorite_at IS NOT NULL GROUP BY m.id ORDER BY m.remote_title COLLATE NOCASE""",
            ).use { p ->
                p.executeQuery().use { r ->
                    generateSequence {
                        if (!r.next()) null else {
                            val id = r.getLong(1)
                            val source = sources[r.getLong(8).toString()]
                            buildJsonObject {
                                put("id", id); put("title", r.getString(2)); put("author", r.getString(3)); put("artist", r.getString(4))
                                put("genre", genres(r.getString(5))); put("status", status(r.getInt(6)))
                                put("thumbnailUrl", if (r.getString(7) != null) "/api/cover/$id" else null)
                                put("sourceId", r.getLong(8).toString())
                                put("source", source?.let { s -> buildJsonObject { put("id", s["id"]!!); put("displayName", s["displayName"]!!); put("lang", s["lang"]!!) } } ?: JsonNull)
                                put("inLibraryAt", seconds(r.getLong(9)))
                                put("updateStrategy", if (r.getInt(10) == 1) "ONLY_FETCH_ONCE" else "ALWAYS_UPDATE")
                                put("chaptersLastFetchedAt", seconds(r.getObject(11)?.let { r.getLong(11) }))
                                put("chapterCount", r.getInt(12)); put("unreadCount", r.getInt(13)); put("bookmarkCount", r.getInt(14))
                                put("downloadCount", 0); put("trackCount", 0)
                                put("lastReadChapter", r.getObject(15)?.let { buildJsonObject { put("lastReadAt", seconds(r.getLong(15))) } } ?: JsonNull)
                                put("latestUploadedChapter", if (r.getInt(12) > 0) buildJsonObject { put("uploadDate", r.getLong(16)) } else JsonNull)
                                put("latestFetchedChapter", if (r.getInt(12) > 0) buildJsonObject { put("fetchedAt", seconds(r.getLong(17))) } else JsonNull)
                            }
                        }
                    }.toList()
                }
            }
            val ids = rows.map { it["id"]!!.jsonPrimitive.content.toLong() }
            val cats = mangaCategories(c, ids)
            val metas = mangaMetas(c, ids)
            buildJsonObject {
                put("categories", JsonArray(categories(c)))
                put("mangas", JsonArray(rows.mapIndexed { i, m -> JsonObject(m + ("categories" to cats[ids[i]]!!) + ("meta" to metas[ids[i]]!!)) }))
            }
        }
    }

    /**
     * Suwayomi's `updateManga(s)` and `updateManga(s)Categories` in one patch: `inLibrary`, `clearCategories`,
     * `addToCategories`, `removeFromCategories`. Default (0) is no row: a manga in no category is in Default.
     */
    private suspend fun updateMangas(input: JsonObject): JsonObject {
        val ids = input.longs("ids")
        val inLibrary = input["inLibrary"]?.let { (it as? JsonPrimitive)?.booleanOrNull ?: throw ApiError(Kind.invalid, "inLibrary is true or false.") }
        val clear = (input["clearCategories"] as? JsonPrimitive)?.booleanOrNull == true
        val add = if ("addToCategories" in input) input.longs("addToCategories").filter { it != 0L } else emptyList()
        val remove = if ("removeFromCategories" in input) input.longs("removeFromCategories") else emptyList()
        return db.run { c ->
            c.transaction {
                requireMangas(c, ids)
                val known = categories(c).map { it["id"]!!.jsonPrimitive.content.toLong() }.toSet()
                (add - known).firstOrNull()?.let { throw ApiError(Kind.notFound, "There is no category $it.") }
                val now = System.currentTimeMillis()
                for (id in ids) {
                    if (inLibrary == true) c.update("UPDATE manga SET user_favorite_at = coalesce(user_favorite_at, ?) WHERE id = ?", now, id)
                    if (inLibrary == false) c.update("UPDATE manga SET user_favorite_at = NULL WHERE id = ?", id)
                    if (clear) c.update("DELETE FROM manga_category WHERE manga_id = ?", id)
                    for (cat in remove) c.update("DELETE FROM manga_category WHERE manga_id = ? AND category_id = ?", id, cat)
                    for (cat in add) c.update("INSERT OR IGNORE INTO manga_category (manga_id, category_id) VALUES (?, ?)", id, cat)
                }
                val cats = mangaCategories(c, ids)
                val favorite = ids.associateWith { id -> c.query("SELECT user_favorite_at IS NOT NULL FROM manga WHERE id = ?", id) { it.getInt(1) == 1 }.single() }
                buildJsonObject {
                    put("mangas", JsonArray(ids.map { id -> buildJsonObject { put("id", id); put("inLibrary", favorite[id]!!); put("categories", cats[id]!!) } }))
                }
            }
        }
    }

    /** `isRead`, `isBookmarked` and `lastPageRead` for many chapters. Saving a page stamps History, as on Suwayomi. */
    private suspend fun updateChapters(input: JsonObject): JsonObject {
        val ids = input.longs("ids")
        val read = input["isRead"]?.let { (it as? JsonPrimitive)?.booleanOrNull ?: throw ApiError(Kind.invalid, "isRead is true or false.") }
        val bookmark = input["isBookmarked"]?.let { (it as? JsonPrimitive)?.booleanOrNull ?: throw ApiError(Kind.invalid, "isBookmarked is true or false.") }
        val page = input["lastPageRead"]?.let { (it as? JsonPrimitive)?.intOrNull?.takeIf { n -> n >= 0 } ?: throw ApiError(Kind.invalid, "lastPageRead is a page index.") }
        return db.run { c ->
            c.transaction {
                val found = c.query("SELECT id FROM chapter WHERE ${among("id")}", idList(ids)) { it.getLong(1) }.toSet()
                (ids - found).firstOrNull()?.let { throw ApiError(Kind.notFound, "There is no chapter $it.") }
                val now = System.currentTimeMillis()
                c.batch("UPDATE chapter SET user_read = coalesce(?, user_read), user_bookmark = coalesce(?, user_bookmark), user_last_page_read = coalesce(?, user_last_page_read) WHERE id = ?",
                    ids.map { listOf(read?.let { if (it) 1 else 0 }, bookmark?.let { if (it) 1 else 0 }, page, it) })
                // Opening or saving a page is reading; mark-unread's reset to page 0 is not, as in History.js.
                if (page != null && read != false) c.batch(
                    """INSERT INTO history (manga_id, chapter_id, read_at) SELECT manga_id, id, ? FROM chapter WHERE id = ?
                       ON CONFLICT (chapter_id) DO UPDATE SET read_at = excluded.read_at""",
                    ids.map { listOf(now, it) },
                )
                buildJsonObject { put("chapters", JsonArray(chapterRows(c, among("ch.id"), idList(ids)))) }
            }
        }
    }

    /** Every category in order, Default first, with the fields `Model.js` and `Categories.js` read. */
    private fun categories(c: Connection): List<JsonObject> {
        val rows = c.query("SELECT id, name, `order`, include_in_update, include_in_download FROM category ORDER BY `order`") { r ->
            buildJsonObject {
                put("id", r.getLong(1)); put("name", if (r.getLong(1) == 0L) "Default" else r.getString(2)); put("order", r.getInt(3))
                put("default", r.getLong(1) == 0L); put("includeInUpdate", r.getString(4)); put("includeInDownload", r.getString(5))
            }
        }
        val metas = metasOf(c, "category", rows.map { it["id"]!!.jsonPrimitive.content.toLong() })
        return rows.map { JsonObject(it + ("meta" to metas[it["id"]!!.jsonPrimitive.content.toLong()]!!)) }
    }

    private fun category(c: Connection, id: Long) = categories(c).firstOrNull { it["id"]!!.jsonPrimitive.content.toLong() == id }
        ?: throw ApiError(Kind.notFound, "There is no category $id.")

    /** Names are checked here as well as in the window, because sync creates categories too. */
    private fun checkName(c: Connection, name: String, except: Long? = null): String {
        val clean = name.trim()
        if (clean.isEmpty()) throw ApiError(Kind.invalid, "A category needs a name.")
        if (clean.equals("default", ignoreCase = true)) throw ApiError(Kind.invalid, "Default is the name of the built-in category.")
        if (c.query("SELECT id FROM category WHERE id > 0 AND lower(name) = lower(?)", clean) { it.getLong(1) }.any { it != except }) {
            throw ApiError(Kind.invalid, "There is already a category named $clean.")
        }
        return clean
    }

    private suspend fun createCategory(name: String): JsonObject = db.run { c ->
        c.transaction {
            val clean = checkName(c, name)
            val order = c.query("SELECT coalesce(max(`order`), 0) + 1 FROM category") { it.getInt(1) }.single()
            val id = c.query("INSERT INTO category (name, `order`) VALUES (?, ?) RETURNING id", clean, order) { it.getLong(1) }.single()
            category(c, id)
        }
    }

    private suspend fun updateCategory(input: JsonObject): JsonObject {
        val id = input.long("id")
        val name = input["name"]?.let { input.string("name") }
        fun include(key: String) = input[key]?.let { v -> (v as? JsonPrimitive)?.contentOrNull?.takeIf { it in INCLUDE } ?: throw ApiError(Kind.invalid, "$key is UNSET, INCLUDE or EXCLUDE.") }
        val update = include("includeInUpdate")
        val download = include("includeInDownload")
        return db.run { c ->
            c.transaction {
                category(c, id)
                if (name != null) {
                    if (id == 0L) throw ApiError(Kind.invalid, "The Default category cannot be renamed.")
                    c.update("UPDATE category SET name = ? WHERE id = ?", checkName(c, name, except = id), id)
                }
                if (update != null) c.update("UPDATE category SET include_in_update = ? WHERE id = ?", update, id)
                if (download != null) c.update("UPDATE category SET include_in_download = ? WHERE id = ?", download, id)
                category(c, id)
            }
        }
    }

    /** Its manga stay in the library, in Default if they are in no other category. Its metas go with it. */
    private suspend fun deleteCategory(id: Long): JsonObject = db.run { c ->
        c.transaction {
            if (id == 0L) throw ApiError(Kind.invalid, "The Default category cannot be deleted.")
            val gone = category(c, id)
            c.update("DELETE FROM category WHERE id = ?", id)
            c.update("DELETE FROM metas WHERE scope = 'category' AND owner = ?", id)
            renumber(c, categories(c).filter { it["id"]!!.jsonPrimitive.content != "0" }.map { it["id"]!!.jsonPrimitive.content.toLong() })
            gone
        }
    }

    /** Moves [id] to [position], counted from 1, because Default sits at 0, as in `updateCategoryOrder`. */
    private suspend fun reorder(id: Long, position: Int): List<JsonObject> = db.run { c ->
        c.transaction {
            if (id == 0L) throw ApiError(Kind.invalid, "The Default category stays first.")
            category(c, id)
            val others = categories(c).map { it["id"]!!.jsonPrimitive.content.toLong() }.filter { it != 0L && it != id }
            if (position < 1 || position > others.size + 1) throw ApiError(Kind.invalid, "position is from 1 to ${others.size + 1}.")
            renumber(c, others.toMutableList().apply { add(position - 1, id) })
            categories(c)
        }
    }

    /** `order` is UNIQUE, so the new orders go through negative ones first. */
    private fun renumber(c: Connection, ids: List<Long>) {
        c.batch("UPDATE category SET `order` = ? WHERE id = ?", ids.mapIndexed { i, id -> listOf(-(i + 2), id) })
        c.batch("UPDATE category SET `order` = ? WHERE id = ?", ids.mapIndexed { i, id -> listOf(i + 1, id) })
    }

    /** `{ scope, owners?, keys? }`: global metas have owner 0. */
    /** One query `{ scope, owners?, keys? }`, or several as `{ queries: [...] }`, answered in that order. */
    private suspend fun getMetas(input: JsonObject): List<JsonObject> {
        (input["queries"] as? JsonArray)?.let { qs -> return qs.flatMap { getMetas(it as? JsonObject ?: throw ApiError(Kind.invalid, "Each query is an object.")) } }
        val scope = input.scope()
        val owners = if ("owners" in input) input.longs("owners") else null
        val keys = if ("keys" in input) input.strings("keys") else null
        val where = buildList {
            add("scope = ?")
            if (owners != null) add(among("owner"))
            if (keys != null) add(among("key"))
        }.joinToString(" AND ")
        return db.run { c ->
            c.query("SELECT scope, owner, key, value FROM metas WHERE $where ORDER BY owner, key", scope, *listOfNotNull(owners?.let(::idList), keys?.let(::textList)).toTypedArray()) { r -> metaJson(r.getString(1), r.getLong(2), r.getString(3), r.getString(4)) }
        }
    }

    /** `{ metas: [{ scope, owner, key, value }] }`, written in one transaction. */
    private suspend fun setMetas(input: JsonObject): List<JsonObject> {
        val metas = (input["metas"] as? JsonArray)?.map { e ->
            val m = e as? JsonObject ?: throw ApiError(Kind.invalid, "Each meta is an object.")
            val scope = m.scope()
            val owner = if (scope == "global") 0L else m.long("owner")
            metaJson(scope, owner, m.string("key"), m.string("value"))
        } ?: throw ApiError(Kind.invalid, "The request needs metas, a list of { scope, owner, key, value }.")
        return db.run { c ->
            c.transaction {
                for (m in metas) {
                    val scope = m.string("scope")
                    val owner = m.long("owner")
                    if (scope == "manga" && c.query("SELECT 1 FROM manga WHERE id = ?", owner) { 1 }.isEmpty()) throw ApiError(Kind.notFound, "There is no manga $owner.")
                    if (scope == "category") category(c, owner)
                }
                c.batch("INSERT INTO metas (scope, owner, key, value) VALUES (?, ?, ?, ?) ON CONFLICT (scope, owner, key) DO UPDATE SET value = excluded.value",
                    metas.map { listOf(it.string("scope"), it.long("owner"), it.string("key"), it.string("value")) })
                metas
            }
        }
    }

    /** `{ scope, owners?, keys }`, as `deleteMangaMetas`. */
    private suspend fun deleteMetas(input: JsonObject): Int {
        val scope = input.scope()
        val owners = if (scope == "global") listOf(0L) else input.longs("owners")
        val keys = input.strings("keys")
        return db.run { c ->
            c.transaction {
                c.update("DELETE FROM metas WHERE scope = ? AND ${among("owner")} AND ${among("key")}", scope, idList(owners), textList(keys))
            }
        }
    }

    /**
     * Chapters by last read, newest first, as History and the reading card read them. History keeps manga outside
     * the library too. `{ limit?, offset?, readOnly? }`; readOnly keeps only read chapters, as the reading card asks.
     */
    private suspend fun history(input: JsonObject): JsonObject {
        val limit = ((input["limit"] as? JsonPrimitive)?.intOrNull ?: 500).coerceIn(1, 1000)
        val offset = ((input["offset"] as? JsonPrimitive)?.intOrNull ?: 0).coerceAtLeast(0)
        val readOnly = (input["readOnly"] as? JsonPrimitive)?.booleanOrNull == true
        return db.run { c ->
            val ids = c.query(
                "SELECT h.chapter_id FROM history h JOIN chapter ch ON ch.id = h.chapter_id WHERE h.read_at > 0 ${if (readOnly) "AND ch.user_read = 1" else ""} ORDER BY h.read_at DESC, h.chapter_id DESC LIMIT ? OFFSET ?",
                limit + 1, offset,
            ) { it.getLong(1) }
            val page = ids.take(limit)
            val chapters = if (page.isEmpty()) emptyMap() else chapterRows(c, among("ch.id"), idList(page)).associateBy { it["id"]!!.jsonPrimitive.content.toLong() }
            val mangaIds = chapters.values.map { it["mangaId"]!!.jsonPrimitive.content.toLong() }.distinct()
            val metas = mangaMetas(c, mangaIds)
            val mangas = mangaIds.associateWith { id ->
                c.query(
                    "SELECT m.remote_title, m.remote_cover, m.user_favorite_at, (SELECT count(*) FROM chapter WHERE manga_id = m.id AND user_read = 0) FROM manga m WHERE m.id = ?", id,
                ) { r ->
                    buildJsonObject {
                        put("id", id); put("title", r.getString(1)); put("thumbnailUrl", if (r.getString(2) != null) "/api/cover/$id" else null)
                        put("inLibrary", r.getObject(3) != null); put("unreadCount", r.getInt(4)); put("meta", metas[id]!!)
                    }
                }.single()
            }
            buildJsonObject {
                put("chapters", JsonArray(page.mapNotNull { chapters[it] }.map { ch -> JsonObject(ch + ("manga" to mangas[ch["mangaId"]!!.jsonPrimitive.content.toLong()]!!)) }))
                put("hasNextPage", ids.size > limit)
            }
        }
    }

    private fun requireMangas(c: Connection, ids: List<Long>) {
        val found = c.query("SELECT id FROM manga WHERE ${among("id")}", idList(ids)) { it.getLong(1) }.toSet()
        (ids - found).firstOrNull()?.let { throw ApiError(Kind.notFound, "There is no manga $it.") }
    }
}

private fun metaJson(scope: String, owner: Long, key: String, value: String) = buildJsonObject {
    put("scope", scope); put("owner", owner); put("key", key); put("value", value)
}

fun genres(text: String?) = JsonArray(text.orEmpty().split(',').map { it.trim() }.filter { it.isNotEmpty() }.map(::JsonPrimitive))

/** Mihon's SManga status codes, by the names Suwayomi's MangaStatus gives them. */
fun status(code: Int) = listOf("UNKNOWN", "ONGOING", "COMPLETED", "LICENSED", "PUBLISHING_FINISHED", "CANCELLED", "ON_HIATUS").getOrElse(code) { "UNKNOWN" }

private fun JsonObject.scope(): String = (this["scope"] as? JsonPrimitive)?.contentOrNull?.takeIf { it in SCOPES }
    ?: throw ApiError(Kind.invalid, "scope is global, manga or category.")

private fun JsonObject.string(k: String): String = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
    ?: throw ApiError(Kind.invalid, "The request needs the string $k.")

private fun JsonObject.long(k: String): Long = (this[k] as? JsonPrimitive)?.longOrNull
    ?: throw ApiError(Kind.invalid, "The request needs $k, a number.")

private fun JsonObject.longs(k: String): List<Long> = (this[k] as? JsonArray)?.map { (it as? JsonPrimitive)?.longOrNull ?: throw ApiError(Kind.invalid, "$k holds numbers.") }
    ?.takeIf { it.isNotEmpty() || k != "ids" } ?: throw ApiError(Kind.invalid, "The request needs $k, a list of ids.")

private fun JsonObject.strings(k: String): List<String> = (this[k] as? JsonArray)?.map { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content ?: throw ApiError(Kind.invalid, "$k holds strings.") }
    ?.takeIf { it.isNotEmpty() } ?: throw ApiError(Kind.invalid, "The request needs $k, a list of strings.")

/** `col IN` the values of one JSON array parameter, so a list of any size fits SQLite's variable limit. */
fun among(col: String) = "$col IN (SELECT value FROM json_each(?))"
fun idList(ids: Collection<Long>) = JsonArray(ids.map(::JsonPrimitive)).toString()
fun textList(items: Collection<String>) = JsonArray(items.map(::JsonPrimitive)).toString()

/** One statement with [args]; returns the rows [map] makes. */
fun <T> Connection.query(sql: String, vararg args: Any?, map: (java.sql.ResultSet) -> T): List<T> = prepareStatement(sql).use { p ->
    args.forEachIndexed { i, a -> p.setObject(i + 1, a) }
    p.executeQuery().use { r -> generateSequence { if (r.next()) map(r) else null }.toList() }
}

fun Connection.update(sql: String, vararg args: Any?): Int = prepareStatement(sql).use { p ->
    args.forEachIndexed { i, a -> p.setObject(i + 1, a) }
    p.executeUpdate()
}

fun Connection.batch(sql: String, rows: List<List<Any?>>) {
    if (rows.isEmpty()) return
    prepareStatement(sql).use { p ->
        for (row in rows) {
            row.forEachIndexed { i, a -> p.setObject(i + 1, a) }
            p.addBatch()
        }
        p.executeBatch()
    }
}
