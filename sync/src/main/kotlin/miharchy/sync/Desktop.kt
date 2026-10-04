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
import kotlin.io.path.readText

@Serializable
data class ServerConfig(val url: String, val username: String, val password: String) {
    companion object {
        fun load() = Json { ignoreUnknownKeys = true }.decodeFromString<ServerConfig>(
            Path.of(System.getProperty("user.home"), ".config/miharchy/server.json").readText(),
        )
    }
}

/** The desktop library plus the Suwayomi ids needed to change it. */
class Snapshot(
    val library: Library,
    val mangaIds: Map<MangaKey, Int>,
    val chapterIds: Map<Pair<MangaKey, String>, Int>,
    val pageCounts: Map<Int, Int>,
    val categoryIds: Map<String, Int>,
)

/** A chapter change that could not be applied because the source no longer lists the chapter. */
@Serializable
data class Skipped(val change: Change, val reason: String)

class Desktop(private val config: ServerConfig) {
    private val http = HttpClient.newHttpClient()
    private val auth = "Basic " + Base64.getEncoder().encodeToString("${config.username}:${config.password}".toByteArray())
    private val endpoint = URI.create(config.url.trimEnd('/') + "/api/graphql")

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
                  chapters { nodes { id url isRead isBookmarked lastPageRead pageCount } }
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
        val pageCounts = mutableMapOf<Int, Int>()
        val manga = data.nodes("mangas").associate { m ->
            val key = MangaKey(m.str("sourceId").toLong(), m.str("url"))
            mangaIds[key] = m.int("id")
            val chapters = m.nodes("chapters").associate { c ->
                chapterIds[key to c.str("url")] = c.int("id")
                pageCounts[c.int("id")] = c.int("pageCount")
                c.str("url") to ChapterState(c.bool("isRead"), c.bool("isBookmarked"), c.int("lastPageRead").toLong())
            }
            key to MangaState(
                title = m.str("title"),
                inLibrary = m.bool("inLibrary"),
                categories = m.nodes("categories").map { it.str("name") }.toSet(),
                chapters = chapters,
            )
        }
        return Snapshot(Library(manga, categoryIds.keys), mangaIds, chapterIds, pageCounts, categoryIds)
    }

    /**
     * Applies [changes] in dependency order and returns the chapter changes it had to skip.
     * Throws on any server error, so the caller keeps the old phone baseline and the next sync retries.
     */
    fun apply(changes: List<Change>, phoneBackup: ByteArray, phoneUrls: Collection<String>): List<Skipped> {
        val categoryIds = snapshot(phoneUrls).categoryIds.toMutableMap()
        for (c in changes.filterIsInstance<CreateCategory>()) {
            categoryIds[c.name] = query(
                "mutation(\$name: String!) { createCategory(input: { name: \$name }) { category { id } } }",
                buildJsonObject { put("name", c.name) },
            ).obj("createCategory").obj("category").int("id")
        }

        val imports = changes.filterIsInstance<ImportManga>().map { it.manga }.toSet()
        if (imports.isNotEmpty()) restore(importBackup(phoneBackup, imports))

        var snap = snapshot(phoneUrls)
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

        val chapterChanges = changes.filter { it is MarkRead || it is MarkUnread || it is AddBookmark || it is RemoveBookmark || it is SetLastPage }
        val missing = chapterChanges.map { it.chapterKey() }.filter { it !in snap.chapterIds }.map { it.first }.toSet()
        for (key in missing) {
            query(
                "mutation(\$id: Int!) { fetchMangaAndChapters(input: { id: \$id, fetchManga: false, fetchChapters: true }) { clientMutationId } }",
                buildJsonObject { put("id", snap.mangaId(key)) },
            )
        }
        if (missing.isNotEmpty()) snap = snapshot(phoneUrls)
        val (known, unknown) = chapterChanges.partition { it.chapterKey() in snap.chapterIds }

        // Suwayomi caps lastPageRead at the chapter's page count, which stays unknown until its pages are fetched.
        for (c in known.filterIsInstance<SetLastPage>()) {
            val id = snap.chapterIds.getValue(c.chapterKey())
            if (c.page > 0 && snap.pageCounts.getValue(id) < c.page) {
                query(
                    "mutation(\$id: Int!) { fetchChapterPages(input: { chapterId: \$id }) { clientMutationId } }",
                    buildJsonObject { put("id", id) },
                )
            }
        }

        val patches = known.groupBy(
            { c ->
                when (c) {
                    is MarkRead -> buildJsonObject { put("isRead", true) }
                    is MarkUnread -> buildJsonObject { put("isRead", false) }
                    is AddBookmark -> buildJsonObject { put("isBookmarked", true) }
                    is RemoveBookmark -> buildJsonObject { put("isBookmarked", false) }
                    is SetLastPage -> buildJsonObject { put("lastPageRead", c.page.toInt()) }
                    else -> error("not a chapter change: $c")
                }
            },
            { snap.chapterIds.getValue(it.chapterKey()) },
        )
        for ((patch, ids) in patches) {
            query(
                "mutation(\$ids: [Int!]!, \$patch: UpdateChapterPatchInput!) { updateChapters(input: { ids: \$ids, patch: \$patch }) { clientMutationId } }",
                buildJsonObject { putJsonArray("ids") { ids.forEach { add(it) } }; put("patch", patch) },
            )
        }
        return unknown.map { Skipped(it, "the source no longer lists this chapter") }
    }

    /** Suwayomi's restore creates the manga rows. Categories stay out: restore would replace them. */
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
                "FAILURE" -> error("Suwayomi failed to restore the new manga")
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

/** A backup holding only the never-seen manga, in the library and without categories or tracking. */
fun importBackup(phone: ByteArray, keys: Set<MangaKey>) = Backup(
    backupManga = decodeBackup(phone).backupManga.filter { MangaKey(it.source, it.url) in keys }.onEach {
        it.favorite = true
        it.categories = emptyList()
        it.tracking = emptyList()
    },
)

private fun Change.chapterKey(): Pair<MangaKey, String> = when (this) {
    is MarkRead -> manga to chapterUrl
    is MarkUnread -> manga to chapterUrl
    is AddBookmark -> manga to chapterUrl
    is RemoveBookmark -> manga to chapterUrl
    is SetLastPage -> manga to chapterUrl
    else -> error("not a chapter change: $this")
}

private fun Snapshot.mangaId(key: MangaKey) = mangaIds[key] ?: error("Suwayomi has no manga $key")

private fun JsonElement.obj(name: String) = jsonObject.getValue(name).jsonObject
private fun JsonElement.str(name: String) = jsonObject.getValue(name).jsonPrimitive.content
private fun JsonElement.int(name: String) = jsonObject.getValue(name).jsonPrimitive.int
private fun JsonElement.bool(name: String) = jsonObject.getValue(name).jsonPrimitive.boolean
private fun JsonElement.nodes(name: String): JsonArray = obj(name).getValue("nodes").jsonArray
