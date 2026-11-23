package miharchy.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.xml.sax.helpers.DefaultHandler
import tachiyomi.domain.chapter.service.ChapterRecognition
import java.io.ByteArrayInputStream
import java.io.IOException
import java.nio.file.Files
import java.nio.file.Path
import java.sql.Connection
import java.util.zip.ZipFile
import javax.xml.parsers.DocumentBuilderFactory
import kotlin.io.path.extension
import kotlin.io.path.isDirectory
import kotlin.io.path.isRegularFile
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.nameWithoutExtension

/** Mihon's id for the local source. */
const val LOCAL_SOURCE = "0"

/** The local source as `source.list` shows it, with the fields the extension sources carry. */
val LOCAL_SOURCE_JSON: JsonObject = buildJsonObject {
    put("id", LOCAL_SOURCE); put("displayName", "Local source"); put("name", "Local source"); put("lang", "other")
    put("iconUrl", JsonNull); put("contentWarning", "SAFE"); put("supportsLatest", true); put("isConfigurable", false)
}

/** The folder the `localSourcePath` setting names, or [default] when it is blank. */
fun localFolder(c: Connection, default: Path): Path =
    setting(c, "localSourcePath").content.takeIf { it.isNotEmpty() }?.let { runCatching { Path.of(it) }.getOrNull() } ?: default

/**
 * Mihon's local source (#374), source 0: a folder per manga directly under the local folder, whose url is the folder name;
 * a chapter is a sub-folder of images or a `.cbz`/`.zip` in it, whose url is `<folder>/<file>`, so backups and the phone
 * sync match Mihon's. [handle] answers the host's JSON ops. [folder] is read on each call, so a changed setting works
 * at once. Core never writes here. Every url is untrusted: it comes from backups and the sync.
 */
class Local(val folder: suspend () -> Path) {
    private val byTitle = compareBy<Path, String>(NATURAL) { it.name }

    suspend fun handle(req: JsonObject): JsonElement = withContext(Dispatchers.IO) {
        try {
            val root = folder()
            when (val op = (req["op"] as? JsonPrimitive)?.content) {
                "popular" -> listing(root, req, null, byTitle)
                "latest" -> listing(root, req, null, compareByDescending<Path> { mtime(it) })
                "search" -> listing(root, req, (req["query"] as? JsonPrimitive)?.contentOrNull.orEmpty(), byTitle)
                "filters", "settings" -> JsonArray(emptyList())
                "urls" -> buildJsonObject {
                    put("manga", JsonNull)
                    put("chapters", JsonArray(req["chapters"]?.jsonArray.orEmpty().map { JsonNull }))
                }
                "update" -> update(root, req["manga"]!!.jsonObject)
                "pages" -> pages(root, (req["chapter"]!!.jsonObject["url"] as JsonPrimitive).content)
                else -> throw ApiError(Kind.invalid, "The local source has no \"$op\".")
            }
        } catch (e: IOException) {
            throw ApiError(Kind.source, "${e::class.java.simpleName}: ${e.message}")
        }
    }

    /** Whether the manga's folder is there, for the library update to skip a manga it cannot rescan. */
    suspend fun exists(url: String): Boolean = withContext(Dispatchers.IO) { runCatching { mangaDir(folder(), url) }.isSuccess }

    /** The bytes of a cover, from its stored url (see [cover]), or of a page: the chapter's url and the page's `imageUrl`. */
    suspend fun image(url: String): ByteArray = withContext(Dispatchers.IO) {
        val root = folder()
        val parts = url.substringBeforeLast('?').split('/')
        when {
            parts.size == 2 && isPageName(parts[1]) -> {
                val file = inside(root, url.substringBeforeLast('?'))
                if (!file.isRegularFile()) throw ApiError(Kind.notFound, "There is no cover $url.")
                Files.readAllBytes(file)
            }
            parts.size > 2 -> pageBytes(root, "${parts[0]}/${parts[1]}", parts.drop(2).joinToString("/"))
            else -> throw ApiError(Kind.notFound, "There is no cover $url.")
        }
    }

    suspend fun page(chapter: String, entry: String): ByteArray = withContext(Dispatchers.IO) { pageBytes(folder(), chapter, entry) }

    // ponytail: every listed manga without a cover file opens its oldest chapter's zip; a cache if a big library is slow.
    private fun listing(root: Path, req: JsonObject, query: String?, order: Comparator<Path>): JsonObject {
        val page = (req["page"] as? JsonPrimitive)?.intOrNull ?: 1
        val found = if (page > 1 || !root.isDirectory()) emptyList() else root.listDirectoryEntries()
            .filter { it.isDirectory() && !it.name.startsWith(".") && (query.isNullOrBlank() || it.name.contains(query, ignoreCase = true)) }
            .sortedWith(order)
        return buildJsonObject {
            put("mangas", JsonArray(found.map { dir ->
                buildJsonObject { put("url", dir.name); put("title", dir.name); put("thumbnailUrl", cover(dir)) }
            }))
            put("hasNextPage", false)
        }
    }

    private fun mangaDir(root: Path, url: String): Path {
        if (url.isEmpty() || '/' in url || url == "." || url == "..") throw ApiError(Kind.invalid, "\"$url\" is not a local manga folder name.")
        val dir = inside(root, url)
        if (!dir.isDirectory()) throw ApiError(Kind.notFound, "The folder $url is not in the local manga folder $root.")
        return dir
    }

    /** A chapter's path: exactly `<folder>/<file>`. */
    private fun chapterPath(root: Path, url: String): Path {
        val parts = url.split('/')
        if (parts.size != 2 || parts.any { it.isEmpty() || it == "." || it == ".." }) throw ApiError(Kind.invalid, "\"$url\" is not a local chapter.")
        val path = inside(root, url)
        if (!Files.exists(path)) throw ApiError(Kind.notFound, "The chapter $url is not in the local manga folder $root.")
        return path
    }

    private fun chapterFiles(dir: Path): List<Path> = dir.listDirectoryEntries().filter {
        !it.name.startsWith(".") && (it.isDirectory() || it.isRegularFile() && it.extension.lowercase() in ARCHIVES)
    }

    private fun mtime(p: Path) = Files.getLastModifiedTime(p).toMillis()

    /**
     * `<rel path>?<mtime>` of `cover.*`, else `<chapter url>/<entry>?<mtime>` of the oldest chapter's first page. The mtime
     * makes a changed cover a new url, so Browse fetches it again.
     */
    private fun cover(dir: Path): String? {
        val file = dir.listDirectoryEntries().firstOrNull { it.isRegularFile() && it.nameWithoutExtension.equals("cover", ignoreCase = true) && isPageName(it.name) }
        if (file != null) return "${dir.name}/${file.name}?${mtime(file)}"
        val chapter = chapterFiles(dir).minWithOrNull { a, b -> NATURAL.compare(a.name, b.name) } ?: return null
        val entry = pageNames(chapter).firstOrNull() ?: return null
        return "${dir.name}/${chapter.name}/$entry?${mtime(if (chapter.isDirectory()) chapter.resolve(entry) else chapter)}"
    }

    private fun pageNames(chapter: Path): List<String> =
        if (chapter.isDirectory()) chapter.listDirectoryEntries().filter { it.isRegularFile() && isPageName(it.name) }.map { it.name }.sortedWith(NATURAL)
        else cbzPages(chapter)

    private fun pages(root: Path, chapterUrl: String): JsonArray = JsonArray(pageNames(chapterPath(root, chapterUrl)).mapIndexed { i, name ->
        buildJsonObject { put("index", i); put("url", chapterUrl); put("imageUrl", name) }
    })

    private fun pageBytes(root: Path, chapterUrl: String, entry: String): ByteArray {
        val chapter = chapterPath(root, chapterUrl)
        if (!isPageName(entry)) throw ApiError(Kind.notFound, "$entry is not a page.")
        if (chapter.isDirectory()) {
            val file = inside(chapter, entry)
            if (!file.isRegularFile()) throw ApiError(Kind.notFound, "The chapter $chapterUrl has no page $entry.")
            return Files.readAllBytes(file)
        }
        return ZipFile(chapter.toFile()).use { z ->
            val e = z.getEntry(entry)?.takeIf { !it.isDirectory } ?: throw ApiError(Kind.notFound, "The chapter $chapterUrl has no page $entry.")
            z.getInputStream(e).use { it.readBytes() }
        }
    }

    private fun update(root: Path, manga: JsonObject): JsonObject {
        val url = (manga["url"] as? JsonPrimitive)?.content.orEmpty()
        val dir = mangaDir(root, url)
        val info = readXml(dir.resolve("ComicInfo.xml"))
        val json = runCatching { Json.parseToJsonElement(Files.readString(dir.resolve("details.json"))).jsonObject }.getOrNull()
        fun text(k: String) = (json?.get(k) as? JsonPrimitive)?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() }
        val genre = info?.get("Genre") ?: (json?.get("genre") as? JsonArray)?.joinToString(",") { it.jsonPrimitive.content } ?: text("genre")
        val title = info?.get("Series") ?: text("title") ?: dir.name
        val status = STATUSES[info?.get("PublishingStatusTachiyomi")] ?: (json?.get("status") as? JsonPrimitive)?.intOrNull ?: 0
        return buildJsonObject {
            put("manga", buildJsonObject {
                put("url", url); put("title", title)
                put("author", info?.get("Writer") ?: text("author")); put("artist", info?.get("Penciller") ?: text("artist"))
                put("description", info?.get("Summary") ?: text("description"))
                put("genre", genre?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }?.joinToString(", "))
                put("status", status); put("updateStrategy", "ALWAYS_UPDATE"); put("initialized", true)
                put("thumbnailUrl", cover(dir))
            })
            put("chapters", JsonArray(chapters(dir, title)))
        }
    }

    /** Newest first, as Mihon's local sort: the number descending, then the name in natural order descending. */
    private fun chapters(dir: Path, title: String): List<JsonObject> {
        class Chapter(val file: Path, val name: String, val given: Double?)
        val found = chapterFiles(dir).map { f ->
            val info = if (f.isDirectory()) null else readXml(f)
            Chapter(f, info?.get("Title") ?: if (f.isDirectory()) f.name else f.nameWithoutExtension, info?.get("Number")?.toDoubleOrNull())
        }.sortedWith { a, b -> NATURAL.compare(b.name, a.name) }
        // Read in name order, newest first, as ChapterRecognition wants the list; the numbers then give the real order.
        val numbers = ChapterRecognition.parseChapterNumbers(title, found.map { ChapterRecognition.Chapter(it.name, it.given ?: -1.0) })
            .map { n -> n.chapter?.let(ChapterRecognition::toDouble) ?: -1.0 }
        return found.indices.sortedWith(compareByDescending<Int> { numbers[it] }.thenComparator { a, b -> NATURAL.compare(found[b].name, found[a].name) }).map { i ->
            val c = found[i]
            buildJsonObject {
                put("url", "${dir.name}/${c.file.name}"); put("name", c.name); put("chapterNumber", numbers[i])
                put("scanlator", JsonNull); put("dateUpload", mtime(c.file)); put("memo", JsonObject(emptyMap()))
            }
        }
    }

    /** `ComicInfo.xml` in a folder, or inside a .cbz/.zip, as element name to text; null when it is missing or broken. */
    private fun readXml(file: Path): Map<String, String>? = try {
        val bytes = if (file.extension.lowercase() in ARCHIVES) ZipFile(file.toFile()).use { z ->
            z.getEntry("ComicInfo.xml")?.let { e -> z.getInputStream(e).use { it.readNBytes(XML_BYTES) } }
        } else if (file.isRegularFile()) Files.newInputStream(file).use { it.readNBytes(XML_BYTES) } else null
        bytes?.let(::parseXml)
    } catch (e: Exception) {
        null
    }

    private fun parseXml(bytes: ByteArray): Map<String, String> {
        val factory = DocumentBuilderFactory.newInstance().apply {
            // A DOCTYPE is the way in for entities, so a file with one is broken here.
            setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
            isXIncludeAware = false; isExpandEntityReferences = false
        }
        val root = factory.newDocumentBuilder().apply { setErrorHandler(DefaultHandler()) }.parse(ByteArrayInputStream(bytes)).documentElement
        val out = mutableMapOf<String, String>()
        for (i in 0 until root.childNodes.length) {
            val n = root.childNodes.item(i)
            if (n.nodeType == org.w3c.dom.Node.ELEMENT_NODE) n.textContent.trim().takeIf { it.isNotEmpty() }?.let { out.putIfAbsent(n.nodeName, it) }
        }
        return out
    }

    private companion object {
        val ARCHIVES = setOf("cbz", "zip")
        const val XML_BYTES = 1 shl 20
        /** Mihon's `ComicInfoPublishingStatus`. */
        val STATUSES = mapOf("Ongoing" to 1, "Completed" to 2, "Licensed" to 3, "Publishing finished" to 4, "Cancelled" to 5, "On hiatus" to 6)
    }
}

/** Natural order, so "2.jpg" comes before "10.jpg": digit runs by value, other text without case; ties fall back to the plain order. */
val NATURAL: Comparator<String> = Comparator { a, b ->
    var i = 0
    var j = 0
    while (i < a.length && j < b.length) {
        if (a[i] in '0'..'9' && b[j] in '0'..'9') {
            val si = i
            val sj = j
            while (i < a.length && a[i] in '0'..'9') i++
            while (j < b.length && b[j] in '0'..'9') j++
            val x = a.substring(si, i).trimStart('0')
            val y = b.substring(sj, j).trimStart('0')
            val c = if (x.length != y.length) x.length.compareTo(y.length) else x.compareTo(y)
            if (c != 0) return@Comparator c
        } else {
            val c = a[i].lowercaseChar().compareTo(b[j].lowercaseChar())
            if (c != 0) return@Comparator c
            i++
            j++
        }
    }
    (a.length - i).compareTo(b.length - j).takeIf { it != 0 } ?: a.compareTo(b)
}
