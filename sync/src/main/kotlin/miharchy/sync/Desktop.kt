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
import kotlinx.serialization.json.contentOrNull
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

private val SYNC_FLAGS = buildJsonObject {
    listOf("Manga", "Chapters", "Categories", "History", "Tracking").forEach { put("include$it", true) }
    put("includeClientData", false)
    put("includeServerSettings", false)
}

private val BACKUP_PARTS = listOf("Categories", "Chapters", "Tracking", "History")

/**
 * What a backup made by hand holds: the library, and what Settings' backup rows ([settings], Suwayomi's automatic
 * backup settings) include. Never client data, as in the sync's export, and never the server settings, which hold
 * the server password.
 */
fun backupFlags(settings: JsonObject): JsonObject = buildJsonObject {
    put("includeManga", true)
    BACKUP_PARTS.forEach { put("include$it", settings.bool("autoBackupInclude$it")) }
    put("includeClientData", false)
    put("includeServerSettings", false)
}

/** Manga meta holding Mihon's notes; Suwayomi's backups have no notes field. */
const val NOTES_KEY = "miharchy.notes"

/** The desktop library plus the Suwayomi ids needed to change it. */
class Snapshot(
    val library: Library,
    val mangaIds: Map<MangaKey, Int>,
    val chapterIds: Map<Pair<MangaKey, String>, Int>,
    val categoryIds: Map<String, Int>,
    val trackRecordIds: Map<Pair<MangaKey, Int>, Int>,
)

private const val LOGIN =
    "mutation(\$username: String!, \$password: String!) { login(input: { username: \$username, password: \$password }) { accessToken refreshToken } }"
private const val REFRESH = "mutation(\$refreshToken: String!) { refreshToken(input: { refreshToken: \$refreshToken }) { accessToken } }"

/**
 * Whether Suwayomi refused the access token: under ui_login, GraphQL answers a missing or expired one with 200 and an
 * `Unauthorized` error, a file request with 401.
 */
fun refusedToken(status: Int, body: String): Boolean = status == 401 || status == 200 && runCatching {
    Json.parseToJsonElement(body).jsonObject["errors"]?.jsonArray?.firstOrNull()?.str("message")?.lineSequence()?.first()?.endsWith(" : Unauthorized")
}.getOrNull() == true

class Desktop(private val config: ServerConfig) {
    private val http = HttpClient.newHttpClient()
    private val endpoint = URI.create(config.url.trimEnd('/') + "/api/graphql")

    /** ui_login's tokens (ADR 0005): a run logs in once and keeps them in memory only. */
    private var access: String? = null
    private var refresh: String? = null

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

    fun backupFlags(): JsonObject = backupFlags(
        query("{ settings { ${BACKUP_PARTS.joinToString(" ") { "autoBackupInclude$it" }} } }", buildJsonObject {}).obj("settings"),
    )

    /**
     * The desktop library as a Mihon backup. By default client data and server settings stay out: the file lands in
     * a shared folder, and the server settings hold the server password.
     */
    fun export(flags: JsonObject = SYNC_FLAGS): ByteArray {
        val url = query(
            "mutation(\$flags: PartialBackupFlagsInput!) { createBackup(input: { flags: \$flags }) { url } }",
            buildJsonObject { put("flags", flags) },
        ).obj("createBackup").str("url")
        val response = authorized(HttpRequest.newBuilder(endpoint.resolve(url)).GET(), HttpResponse.BodyHandlers.ofByteArray()) {
            it.statusCode() == 401
        }
        check(response.statusCode() == 200) { "Suwayomi answered HTTP ${response.statusCode()} for the backup" }
        return response.body()
    }

    /** Each library manga's notes, which [export] cannot carry: Suwayomi's backup has no notes field. */
    fun notes(): Map<MangaKey, String> = query(
        "{ mangas(filter: { inLibrary: { equalTo: true } }) { nodes { sourceId url meta { key value } } } }",
        buildJsonObject {},
    ).nodes("mangas").associate { MangaKey(it.str("sourceId").toLong(), it.str("url")) to it.notes() }.filterValues { it.isNotEmpty() }

    /** Library manga plus any manga the phone backup names, so phone changes find their desktop rows. */
    fun snapshot(phoneUrls: Collection<String>): Snapshot {
        val data = query(
            """
            query(${'$'}urls: [String!]!) {
              categories { nodes { id name } }
              mangas(filter: { or: [{ inLibrary: { equalTo: true } }, { url: { in: ${'$'}urls } }] }) {
                nodes {
                  id sourceId url title inLibrary
                  meta { key value }
                  categories { nodes { name } }
                  chapters { nodes { id url isRead isBookmarked lastPageRead } }
                  trackRecords {
                    nodes { id trackerId remoteId libraryId title remoteUrl totalChapters lastChapterRead status score startDate finishDate private }
                  }
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
        val trackRecordIds = mutableMapOf<Pair<MangaKey, Int>, Int>()
        val manga = data.nodes("mangas").associate { m ->
            val key = MangaKey(m.str("sourceId").toLong(), m.str("url"))
            mangaIds[key] = m.int("id")
            val chapters = m.nodes("chapters").associate { c ->
                chapterIds[key to c.str("url")] = c.int("id")
                c.str("url") to ChapterState(c.bool("isRead"), c.bool("isBookmarked"), c.int("lastPageRead").toLong())
            }
            val tracks = m.nodes("trackRecords").filter { it.int("trackerId") in TRACKER_NAMES }.associate { t ->
                trackRecordIds[key to t.int("trackerId")] = t.int("id")
                t.int("trackerId") to TrackState(
                    remoteId = t.str("remoteId").toLong(),
                    libraryId = t.jsonObject.getValue("libraryId").jsonPrimitive.contentOrNull?.toLong() ?: 0,
                    title = t.str("title"),
                    remoteUrl = t.str("remoteUrl"),
                    totalChapters = t.int("totalChapters"),
                    lastChapterRead = t.str("lastChapterRead").toFloat(),
                    status = t.int("status"),
                    score = t.str("score").toFloat(),
                    startDate = t.str("startDate").toLong(),
                    finishDate = t.str("finishDate").toLong(),
                    private = t.bool("private"),
                )
            }
            key to MangaState(
                title = m.str("title"),
                inLibrary = m.bool("inLibrary"),
                categories = m.nodes("categories").map { it.str("name") }.toSet(),
                chapters = chapters,
                tracks = tracks,
                notes = m.notes(),
            )
        }
        return Snapshot(Library(manga, categoryIds.keys.toList()), mangaIds, chapterIds, categoryIds, trackRecordIds)
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

        // Restore never deletes a track, and on one the desktop has it only sets the tracker entry's ids and raises
        // chapters read. A track it cannot reach is unbound first, locally only, so the restore inserts it whole.
        val unbinds = changes.filterIsInstance<TrackChange>().filter { c ->
            c is UnbindTrack || (c is UpdateTrack && snap.library.manga[c.manga]?.tracks?.get(c.tracker)?.restoredWith(c.track) != c.track)
        }
        for (c in unbinds) {
            val id = snap.trackRecordIds[c.manga to c.tracker] ?: continue
            query(
                "mutation(\$id: Int!) { unbindTrack(input: { recordId: \$id, deleteRemoteTrack: false }) { clientMutationId } }",
                buildJsonObject { put("id", id) },
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

        for (c in changes.filterIsInstance<SetNotes>()) {
            query(
                "mutation(\$id: Int!, \$key: String!, \$value: String!) { setMangaMeta(input: { meta: { mangaId: \$id, key: \$key, value: \$value } }) { clientMutationId } }",
                buildJsonObject { put("id", snap.mangaId(c.manga)); put("key", NOTES_KEY); put("value", c.notes) },
            )
        }

        // Suwayomi's restore logs a failed manga and still reports success.
        val result = snapshot(phoneUrls).library
        val missed = changes.filterNot { it.isAppliedTo(result) }
        check(missed.isEmpty()) { "Suwayomi did not apply: $missed" }
    }

    /** Categories stay out: Suwayomi's restore would replace them. Tracks restore into its database only, never to the tracker. */
    private fun restore(backup: Backup) = restoreFile(encodeBackup(backup), includeCategories = false) {}

    /** The sources and trackers [backup] needs that the server lacks, from Suwayomi's `validateBackup`. */
    fun validate(backup: ByteArray): Check {
        val result = upload(
            "query(\$backup: Upload!) { validateBackup(input: { backup: \$backup }) { missingSources { id name } missingTrackers { name } } }",
            backup,
        ).obj("validateBackup")
        return Check(
            missingSources = result.getValue("missingSources").jsonArray.map { s -> s.str("name").ifBlank { s.str("id") } },
            missingTrackers = result.getValue("missingTrackers").jsonArray.map { it.str("name") },
        )
    }

    /**
     * Restores [backup] and reports each new progress step until it ends. Client data and server settings stay out,
     * as in [export]: a Suwayomi backup's server settings hold its server password.
     */
    fun restoreFile(backup: ByteArray, includeCategories: Boolean = true, onProgress: (RestoreProgress) -> Unit) {
        val id = upload(
            """
            mutation(${'$'}backup: Upload!) {
              restoreBackup(input: { backup: ${'$'}backup, flags: {
                includeManga: true, includeChapters: true, includeHistory: true, includeCategories: $includeCategories,
                includeTracking: true, includeClientData: false, includeServerSettings: false
              } }) { id }
            }
            """,
            backup,
        ).obj("restoreBackup").str("id")

        var last: RestoreProgress? = null
        while (true) {
            val s = query("query(\$id: String!) { restoreStatus(id: \$id) { state mangaProgress totalManga } }", buildJsonObject { put("id", id) })
                .obj("restoreStatus")
            val status = RestoreProgress(s.str("state"), s.int("mangaProgress"), s.int("totalManga"))
            if (status != last) onProgress(status)
            last = status
            when (status.state) {
                "SUCCESS" -> return
                "FAILURE" -> error("Suwayomi could not restore the backup.")
            }
            Thread.sleep(250)
        }
    }

    /** A GraphQL request whose variable `backup` is the file, sent as the GraphQL multipart request spec says. */
    private fun upload(query: String, backup: ByteArray): JsonObject {
        val operations = buildJsonObject {
            put("query", query)
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
            part("0", "; filename=\"miharchy-import.tachibk\"\r\nContent-Type: application/octet-stream", backup)
            write("--$boundary--\r\n".toByteArray())
        }.toByteArray()
        return send(
            HttpRequest.newBuilder(endpoint)
                .header("Content-Type", "multipart/form-data; boundary=$boundary")
                .POST(HttpRequest.BodyPublishers.ofByteArray(body)),
        )
    }

    private fun query(query: String, variables: JsonObject): JsonObject = send(
        HttpRequest.newBuilder(endpoint)
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(buildJsonObject { put("query", query); put("variables", variables) }.toString())),
    )

    private fun send(request: HttpRequest.Builder): JsonObject {
        val response = authorized(request, HttpResponse.BodyHandlers.ofString()) { refusedToken(it.statusCode(), it.body()) }
        check(response.statusCode() == 200) { "Suwayomi answered HTTP ${response.statusCode()}: ${response.body().take(500)}" }
        val json = Json.parseToJsonElement(response.body()).jsonObject
        json["errors"]?.let { error("Suwayomi GraphQL error: $it") }
        return json.obj("data")
    }

    /** Sends [request] with the access token. A refused token is renewed once, and the request goes once more. */
    private fun <T> authorized(
        request: HttpRequest.Builder,
        handler: HttpResponse.BodyHandler<T>,
        refused: (HttpResponse<T>) -> Boolean,
    ): HttpResponse<T> {
        fun attempt(token: String) = http.send(request.copy().header("Authorization", "Bearer $token").build(), handler)
        val response = attempt(access ?: login())
        return if (refused(response)) attempt(renew()) else response
    }

    /** A new access token from the refresh token, or from a new login when the refresh fails. */
    private fun renew(): String =
        refresh?.let { tokens(REFRESH, buildJsonObject { put("refreshToken", it) }, "refreshToken") }?.str("accessToken")?.also { access = it }
            ?: login()

    private fun login(): String {
        val tokens = tokens(LOGIN, buildJsonObject { put("username", config.username); put("password", config.password) }, "login")
            ?: error("Suwayomi refused the login with the username and password in server.json.")
        refresh = tokens.str("refreshToken")
        return tokens.str("accessToken").also { access = it }
    }

    /** A login or refresh mutation's [field], or null when it fails. It sends no token: login refuses one. */
    private fun tokens(query: String, variables: JsonObject, field: String): JsonObject? {
        val response = http.send(
            HttpRequest.newBuilder(endpoint)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(buildJsonObject { put("query", query); put("variables", variables) }.toString()))
                .build(),
            HttpResponse.BodyHandlers.ofString(),
        )
        if (response.statusCode() != 200) return null
        val json = runCatching { Json.parseToJsonElement(response.body()).jsonObject }.getOrNull() ?: return null
        if (json["errors"] != null) return null
        return (json["data"] as? JsonObject)?.get(field) as? JsonObject
    }
}

/** What Suwayomi's restore makes of this desktop track given [track] (BackupMangaHandler.restoreMangaTrackerData). */
fun TrackState.restoredWith(track: TrackState) =
    copy(remoteId = track.remoteId, libraryId = track.libraryId, lastChapterRead = maxOf(lastChapterRead, track.lastChapterRead))

/**
 * What Suwayomi's restore merges in: a never-seen manga whole, in the library; any other manga with only its
 * changed chapters and tracks, outside the library so the restore leaves that flag alone. Restore inserts missing
 * chapters and keeps `read || db`, `bookmark || db` and `max(lastPageRead, db)`, so each chapter carries its raised
 * values and false or 0 (no change) elsewhere. Lowered values were reset before the restore. Each manga carries
 * only its merged tracks to bind or update.
 */
fun restoreBackup(phone: ByteArray, changes: List<Change>, desktop: Library): Backup {
    val imports = changes.filterIsInstance<ImportManga>().map { it.manga }.toSet()
    val chapterChanges = changes.filterIsInstance<ChapterChange>().groupBy { it.manga }
    val tracks = changes.mapNotNull { c ->
        when (c) {
            is BindTrack -> c.manga to c.track.toBackup(c.tracker)
            is UpdateTrack -> c.manga to c.track.toBackup(c.tracker)
            else -> null
        }
    }.groupBy({ it.first }, { it.second })
    return Backup(
        backupManga = decodeBackup(phone).backupManga.mapNotNull { m ->
            val key = MangaKey(m.source, m.url)
            if (key !in imports) {
                if (key !in chapterChanges && key !in tracks) return@mapNotNull null
                val byUrl = chapterChanges[key].orEmpty().groupBy { it.chapterUrl }
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
                tracking = tracks[key].orEmpty()
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
        is BindTrack -> library.manga[manga]?.tracks?.get(tracker) == track
        is UpdateTrack -> library.manga[manga]?.tracks?.get(tracker) == track
        is UnbindTrack -> library.manga[manga]?.tracks?.containsKey(tracker) != true
        is SetNotes -> library.manga[manga]?.notes == notes
    }
}

private fun Snapshot.mangaId(key: MangaKey) = mangaIds[key] ?: error("Suwayomi has no manga $key")

private fun JsonElement.notes() = jsonObject.getValue("meta").jsonArray.firstOrNull { it.str("key") == NOTES_KEY }?.str("value").orEmpty()

private fun JsonElement.obj(name: String) = jsonObject.getValue(name).jsonObject
private fun JsonElement.str(name: String) = jsonObject.getValue(name).jsonPrimitive.content
private fun JsonElement.int(name: String) = jsonObject.getValue(name).jsonPrimitive.int
private fun JsonElement.bool(name: String) = jsonObject.getValue(name).jsonPrimitive.boolean
private fun JsonElement.nodes(name: String): JsonArray = obj(name).getValue("nodes").jsonArray
