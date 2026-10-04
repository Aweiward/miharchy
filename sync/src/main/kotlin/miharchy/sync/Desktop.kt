package miharchy.sync

import eu.kanade.tachiyomi.data.backup.models.Backup
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Path
import java.util.Base64
import kotlin.io.path.exists
import kotlin.io.path.readText

@Serializable
data class ServerConfig(val url: String, val username: String, val password: String) {
    companion object {
        /** The window and the mark honor MIHARCHY_SERVER_JSON, so the helper they start does too. */
        fun load(): ServerConfig {
            val path = System.getenv("MIHARCHY_SERVER_JSON")?.let(Path::of) ?: Path.of(System.getProperty("user.home"), ".config/miharchy/server.json")
            check(path.exists()) { "No server config at $path. Run Setup in the window." }
            return Json { ignoreUnknownKeys = true }.decodeFromString<ServerConfig>(path.readText())
        }
    }
}

const val SOURCE_NAMES_KEY = "miharchy.sourceNames"

/** The desktop library plus the Suwayomi ids needed to change it. */
class Snapshot(
    val library: Library,
    val mangaIds: Map<MangaKey, Int>,
    val chapterIds: Map<Pair<MangaKey, String>, Int>,
    val categoryIds: Map<String, Int>,
)

class Desktop(private val config: ServerConfig) {
    private val http = HttpClient.newHttpClient()
    private val auth = "Basic " + Base64.getEncoder().encodeToString("${config.username}:${config.password}".toByteArray())
    private val endpoint = URI.create(config.url.trimEnd('/') + "/api/graphql")

    /** The folder Setup or Settings stored in meta `miharchy.syncFolder`, or null when none is set. */
    fun syncFolder(): String? = query(
        "query(\$key: String!) { metas(filter: { key: { equalTo: \$key } }) { nodes { value } } }",
        buildJsonObject { put("key", "miharchy.syncFolder") },
    ).nodes("metas").firstOrNull()?.str("value")?.takeIf { it.isNotBlank() }

    /** Meta `miharchy.sourceNames`, source id to name; unreadable JSON counts as none. */
    fun sourceNames(): Map<String, String> {
        val value = query(
            "query(\$key: String!) { metas(filter: { key: { equalTo: \$key } }) { nodes { value } } }",
            buildJsonObject { put("key", SOURCE_NAMES_KEY) },
        ).nodes("metas").firstOrNull()?.str("value") ?: return emptyMap()
        val names = runCatching { Json.parseToJsonElement(value).jsonObject }.getOrNull() ?: return emptyMap()
        return names.mapNotNull { (id, name) -> (name as? JsonPrimitive)?.takeIf { it.isString }?.let { id to it.content } }.toMap()
    }

    fun setSourceNames(names: Map<String, String>) {
        query(
            "mutation(\$key: String!, \$value: String!) { setGlobalMeta(input: { meta: { key: \$key, value: \$value } }) { meta { key } } }",
            buildJsonObject {
                put("key", SOURCE_NAMES_KEY)
                put("value", buildJsonObject { names.forEach { (id, name) -> put(id, name) } }.toString())
            },
        )
    }

    /**
     * The desktop library as a Mihon backup. Client data and server settings stay out: the file lands in a
     * shared folder, and the server settings hold the server password.
     */
    fun export(): ByteArray {
        val url = query(
            """
            mutation {
              createBackup(input: { flags: {
                includeManga: true, includeChapters: true, includeCategories: true, includeHistory: true,
                includeTracking: true, includeClientData: false, includeServerSettings: false
              } }) { url }
            }
            """,
            buildJsonObject {},
        ).obj("createBackup").str("url")
        val response = http.send(
            HttpRequest.newBuilder(endpoint.resolve(url)).header("Authorization", auth).GET().build(),
            HttpResponse.BodyHandlers.ofByteArray(),
        )
        check(response.statusCode() == 200) { "Suwayomi answered HTTP ${response.statusCode()} for the backup" }
        return response.body()
    }

    /** Library manga plus any manga the phone backup names, so phone changes find their desktop rows. */
    fun snapshot(phoneUrls: Collection<String>): Snapshot {
        val data = query(
            """
            query(${'$'}urls: [String!]!) {
              categories { nodes { id name } }
              mangas(filter: { or: [{ inLibrary: { equalTo: true } }, { url: { in: ${'$'}urls } }] }) {
                nodes {
                  id sourceId url title inLibrary
                  categories { nodes { name } }
                  chapters { nodes { id url isRead isBookmarked lastPageRead } }
                }
              }
            }
            """,
            buildJsonObject { putJsonArray("urls") { phoneUrls.forEach { add(JsonPrimitive(it)) } } },
        )
        // Suwayomi's built-in "Default" category (id 0) means "no category", as in Mihon.
        val categoryIds = data.nodes("categories").map { it.str("name") to it.int("id") }.filter { it.second != 0 }.toMap()
        val mangaIds = mutableMapOf<MangaKey, Int>()
        val chapterIds = mutableMapOf<Pair<MangaKey, String>, Int>()
        val manga = data.nodes("mangas").associate { m ->
            val key = MangaKey(m.str("sourceId").toLong(), m.str("url"))
            mangaIds[key] = m.int("id")
            val chapters = m.nodes("chapters").associate { c ->
                chapterIds[key to c.str("url")] = c.int("id")
                c.str("url") to ChapterState(c.bool("isRead"), c.bool("isBookmarked"), c.int("lastPageRead").toLong())
            }
            key to MangaState(
                title = m.str("title"),
                inLibrary = m.bool("inLibrary"),
                categories = m.nodes("categories").map { it.str("name") }.toSet(),
                chapters = chapters,
            )
        }
        return Snapshot(Library(manga, categoryIds.keys.toList()), mangaIds, chapterIds, categoryIds)
    }

    /**
     * Applies [changes] without contacting any source, then checks that every change landed.
     * Throws on any server error or miss, so the caller keeps the old phone baseline and the next sync retries.
     */
    fun apply(changes: List<Change>, phoneBackup: ByteArray, phoneUrls: Collection<String>) {
        val categoryIds = snapshot(phoneUrls).categoryIds.toMutableMap()
        for (c in changes.filterIsInstance<CreateCategory>()) {
            categoryIds[c.name] = query(
                "mutation(\$name: String!) { createCategory(input: { name: \$name }) { category { id } } }",
                buildJsonObject { put("name", c.name) },
            ).obj("createCategory").obj("category").int("id")
        }

        // Restore can only raise read state, so whatever must go down is reset first. A lower page resets to 0,
        // because updateChapters caps lastPageRead at the page count, unknown (-1) until the pages are fetched.
        var snap = snapshot(phoneUrls)
        val resets = changes.filterIsInstance<ChapterChange>().mapNotNull { c ->
            val id = snap.chapterIds[c.manga to c.chapterUrl] ?: return@mapNotNull null
            when (c) {
                is MarkUnread -> buildJsonObject { put("isRead", false) }
                is RemoveBookmark -> buildJsonObject { put("isBookmarked", false) }
                is SetLastPage -> buildJsonObject { put("lastPageRead", 0) }
                    .takeIf { c.page < snap.library.manga.getValue(c.manga).chapter(c.chapterUrl).lastPageRead }
                else -> null
            }?.let { it to id }
        }.groupBy({ it.first }, { it.second })
        for ((patch, ids) in resets) {
            query(
                "mutation(\$ids: [Int!]!, \$patch: UpdateChapterPatchInput!) { updateChapters(input: { ids: \$ids, patch: \$patch }) { clientMutationId } }",
                buildJsonObject { putJsonArray("ids") { ids.forEach { add(it) } }; put("patch", patch) },
            )
        }

        val backup = restoreBackup(phoneBackup, changes, snap.library)
        if (backup.backupManga.isNotEmpty()) restore(backup)

        snap = snapshot(phoneUrls)
        for ((inLibrary, keys) in listOf(
            true to changes.filterIsInstance<AddToLibrary>().map { it.manga },
            false to changes.filterIsInstance<RemoveFromLibrary>().map { it.manga },
        )) {
            if (keys.isEmpty()) continue
            query(
                "mutation(\$ids: [Int!]!, \$v: Boolean!) { updateMangas(input: { ids: \$ids, patch: { inLibrary: \$v } }) { clientMutationId } }",
                buildJsonObject { putJsonArray("ids") { keys.forEach { add(snap.mangaId(it)) } }; put("v", inLibrary) },
            )
        }
        for (c in changes.filterIsInstance<SetCategories>()) {
            query(
                "mutation(\$id: Int!, \$add: [Int!]!) { updateMangaCategories(input: { id: \$id, patch: { clearCategories: true, addToCategories: \$add } }) { clientMutationId } }",
                buildJsonObject { put("id", snap.mangaId(c.manga)); putJsonArray("add") { c.categories.forEach { add(categoryIds.getValue(it)) } } },
            )
        }

        // Suwayomi's restore logs a failed manga and still reports success.
        val result = snapshot(phoneUrls).library
        val missed = changes.filterNot { it.isAppliedTo(result) }
        check(missed.isEmpty()) { "Suwayomi did not apply: $missed" }
    }

    /** Categories stay out: Suwayomi's restore would replace them. */
    private fun restore(backup: Backup) {
        val operations = buildJsonObject {
            put(
                "query",
                """
                mutation(${'$'}backup: Upload!) {
                  restoreBackup(input: { backup: ${'$'}backup, flags: {
                    includeManga: true, includeChapters: true, includeHistory: true, includeCategories: false,
                    includeTracking: false, includeClientData: false, includeServerSettings: false
                  } }) { id }
                }
                """,
            )
            putJsonObject("variables") { put("backup", JsonNull) }
        }
        val boundary = "miharchy-" + System.nanoTime()
        val body = java.io.ByteArrayOutputStream().apply {
            fun part(name: String, headers: String, content: ByteArray) {
                write("--$boundary\r\nContent-Disposition: form-data; name=\"$name\"$headers\r\n\r\n".toByteArray())
                write(content)
                write("\r\n".toByteArray())
            }
            part("operations", "", operations.toString().toByteArray())
            part("map", "", """{"0":["variables.backup"]}""".toByteArray())
            part("0", "; filename=\"miharchy-import.tachibk\"\r\nContent-Type: application/octet-stream", encodeBackup(backup))
            write("--$boundary--\r\n".toByteArray())
        }.toByteArray()
        val id = send(
            HttpRequest.newBuilder(endpoint)
                .header("Content-Type", "multipart/form-data; boundary=$boundary")
                .POST(HttpRequest.BodyPublishers.ofByteArray(body)),
        ).obj("restoreBackup").str("id")

        while (true) {
            val status = query("query(\$id: String!) { restoreStatus(id: \$id) { state } }", buildJsonObject { put("id", id) })
            when (status.obj("restoreStatus").str("state")) {
                "SUCCESS" -> return
                "FAILURE" -> error("Suwayomi failed to restore the phone backup")
            }
            Thread.sleep(250)
        }
    }

    private fun query(query: String, variables: JsonObject): JsonObject = send(
        HttpRequest.newBuilder(endpoint)
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(buildJsonObject { put("query", query); put("variables", variables) }.toString())),
    )

    private fun send(request: HttpRequest.Builder): JsonObject {
        val response = http.send(request.header("Authorization", auth).build(), HttpResponse.BodyHandlers.ofString())
        check(response.statusCode() == 200) { "Suwayomi answered HTTP ${response.statusCode()}: ${response.body().take(500)}" }
        val json = Json.parseToJsonElement(response.body()).jsonObject
        json["errors"]?.let { error("Suwayomi GraphQL error: $it") }
        return json.obj("data")
    }
}

/**
 * What Suwayomi's restore merges in: a never-seen manga whole, in the library; any other manga with only its
 * changed chapters, outside the library so the restore leaves that flag alone. Restore inserts missing chapters
 * and keeps `read || db`, `bookmark || db` and `max(lastPageRead, db)`, so each chapter carries its raised values
 * and false or 0 (no change) elsewhere. Lowered values were reset before the restore.
 */
fun restoreBackup(phone: ByteArray, changes: List<Change>, desktop: Library): Backup {
    val imports = changes.filterIsInstance<ImportManga>().map { it.manga }.toSet()
    val chapterChanges = changes.filterIsInstance<ChapterChange>().groupBy { it.manga }
    return Backup(
        backupManga = decodeBackup(phone).backupManga.mapNotNull { m ->
            val key = MangaKey(m.source, m.url)
            if (key !in imports) {
                val byUrl = chapterChanges[key]?.groupBy { it.chapterUrl } ?: return@mapNotNull null
                val known = desktop.manga[key]?.chapters.orEmpty()
                val chapters = m.chapters.filter { it.url in byUrl }
                val inserted = chapters.count { it.url !in known }
                for (c in chapters) {
                    val cs = byUrl.getValue(c.url)
                    c.read = cs.any { it is MarkRead }
                    c.bookmark = cs.any { it is AddBookmark }
                    c.lastPageRead = cs.filterIsInstance<SetLastPage>().firstOrNull()?.page ?: 0
                    // Restore numbers inserted chapters `inserted - sourceOrder`. This makes that `total - sourceOrder`,
                    // the number a source refresh gives (oldest 1, newest total), so the chapter list stays in order.
                    if (c.url !in known) c.sourceOrder = inserted - (m.chapters.size - c.sourceOrder)
                }
                m.chapters = chapters
            }
            m.apply {
                favorite = key in imports
                categories = emptyList()
                tracking = emptyList()
            }
        },
    )
}

/** Whether [library] shows this change, so apply can tell what landed. */
fun Change.isAppliedTo(library: Library): Boolean {
    fun chapter(c: ChapterChange) = library.manga[c.manga]?.chapters?.get(c.chapterUrl)
    return when (this) {
        is CreateCategory -> name in library.categories
        is ImportManga -> library.manga[manga]?.inLibrary == true
        is AddToLibrary -> library.manga[manga]?.inLibrary == true
        is RemoveFromLibrary -> library.manga[manga]?.inLibrary == false
        is SetCategories -> library.manga[manga]?.categories == categories
        is MarkRead -> chapter(this)?.read == true
        is MarkUnread -> chapter(this)?.read == false
        is AddBookmark -> chapter(this)?.bookmark == true
        is RemoveBookmark -> chapter(this)?.bookmark == false
        is SetLastPage -> chapter(this)?.lastPageRead == page
    }
}

private fun Snapshot.mangaId(key: MangaKey) = mangaIds[key] ?: error("Suwayomi has no manga $key")

private fun JsonElement.obj(name: String) = jsonObject.getValue(name).jsonObject
private fun JsonElement.str(name: String) = jsonObject.getValue(name).jsonPrimitive.content
private fun JsonElement.int(name: String) = jsonObject.getValue(name).jsonPrimitive.int
private fun JsonElement.bool(name: String) = jsonObject.getValue(name).jsonPrimitive.boolean
private fun JsonElement.nodes(name: String): JsonArray = obj(name).getValue("nodes").jsonArray
