package yomi.host

import android.app.Application
import android.content.Context
import eu.kanade.tachiyomi.network.BrowserFetch
import eu.kanade.tachiyomi.network.CloudflareChallengeException
import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.network.NetworkHelper
import eu.kanade.tachiyomi.network.awaitSuccess
import okio.buffer
import okio.sink
import okhttp3.HttpUrl.Companion.toHttpUrl
import uy.kohesive.injekt.api.get
import eu.kanade.tachiyomi.source.CatalogueSource
import eu.kanade.tachiyomi.source.Source
import eu.kanade.tachiyomi.source.SourceFactory
import eu.kanade.tachiyomi.source.model.MangasPage
import eu.kanade.tachiyomi.source.model.Page
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.SManga
import eu.kanade.tachiyomi.source.model.UpdateStrategy
import eu.kanade.tachiyomi.source.online.HttpSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.float
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.addSingleton
import uy.kohesive.injekt.api.addSingletonFactory
import java.io.File
import java.io.FileDescriptor
import java.io.FileOutputStream
import java.io.PrintStream
import java.net.URLClassLoader
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.jar.JarFile

/** Extension host. One JSON request per line on stdin, one reply per line on stdout, in any order. */
fun main(args: Array<String>) {
    Protocol.out = PrintStream(FileOutputStream(FileDescriptor.out), true, Charsets.UTF_8)
    System.setOut(System.err) // anything an extension prints must not corrupt the protocol

    Context.setDataDir(File(args.getOrNull(0) ?: System.getenv("NANO_HOST_DATA") ?: "${System.getProperty("user.home")}/.yomi-host"))
    val app = Application()
    downloadsDir().deleteRecursively() // leftovers from a run that crashed before the app read them
    val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    Injekt.addSingleton<Application>(app)
    Injekt.addSingletonFactory { NetworkHelper(app) }
    Injekt.addSingletonFactory { json }
    // Mihon provides these too, and extensions fetch them by type (MANGA Plus needs ProtoBuf).
    Injekt.addSingletonFactory<kotlinx.serialization.protobuf.ProtoBuf> { kotlinx.serialization.protobuf.ProtoBuf }

    val host = Host()
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    runBlocking {
        // readLine() uses the system charset, which isn't UTF-8 on Windows before Java 18.
        val input = System.`in`.bufferedReader(Charsets.UTF_8)
        generateSequence(input::readLine).forEach { line ->
            if (line.isBlank()) return@forEach
            // Events from the app's web views aren't requests.
            if (line.contains("\"wvEvent\"")) {
                runCatching { WebViews.onEvent(Json.parseToJsonElement(line).jsonObject) }.onFailure { it.printStackTrace() }
                return@forEach
            }
            scope.launch {
                val reply = try {
                    val req = Json.parseToJsonElement(line).jsonObject
                    val id = req["id"] ?: JsonNull
                    try {
                        buildJsonObject { put("id", id); put("result", host.handle(req)) }
                    } catch (e: Throwable) {
                        buildJsonObject {
                            put("id", id)
                            // Wrappers like ExceptionInInitializerError hide the real reason, so report the whole chain.
                            put("error", generateSequence(e) { it.cause }.joinToString(" <- ") { "${it::class.java.name}: ${it.message}" })
                            e.printStackTrace()
                            System.err.println(android.util.Log.RULE)
                            // Extensions may wrap it, so look through the cause chain.
                            generateSequence(e) { it.cause }.filterIsInstance<CloudflareChallengeException>().firstOrNull()?.let {
                                put("challenge", buildJsonObject { put("url", it.url); put("userAgent", it.userAgent) })
                            }
                        }
                    }
                } catch (e: Exception) {
                    buildJsonObject { put("id", JsonNull); put("error", "bad request: ${e.message}") }
                }
                Protocol.send(reply.toString())
            }
        }
        // stdin closed, so the app's gone. Let requests reply, then exit, since OkHttp's threads keep the JVM alive.
        kotlinx.coroutines.withTimeoutOrNull(10_000) {
            scope.coroutineContext[kotlinx.coroutines.Job]!!.children.forEach { it.join() }
        }
    }
    kotlin.system.exitProcess(0)
}

class Host {
    private val sources = ConcurrentHashMap<String, Source>()

    suspend fun handle(req: JsonObject): JsonElement {
        fun str(k: String) = req[k]?.jsonPrimitive?.content ?: throw IllegalArgumentException("missing '$k'")
        fun source() = sources[str("source")] ?: throw IllegalArgumentException("unknown source ${str("source")}")
        fun page() = req["page"]?.jsonPrimitive?.int ?: 1

        return when (str("op")) {
            "load" -> JsonArray(load(File(str("jar")), str("signingKey")).map { it.toJson() })
            "popular" -> source().getPopularManga(page()).toJson()
            "latest" -> source().getLatestUpdates(page()).toJson()
            "filters" -> source().getFilterList().toJson()
            // Filters come back in the shape "filters" returned and are applied to a fresh list.
            "search" -> source().let { src ->
                val filters = src.getFilterList()
                (req["filters"] as? JsonArray)?.let { filters.applyJson(it) }
                val query = req["query"]?.jsonPrimitive?.content ?: ""
                val found = src.getSearchManga(page(), query, filters)
                // Sites keep titles with a straight or a curly apostrophe, so try the other when nothing matches.
                otherApostrophe(query)?.takeIf { page() == 1 && found.mangas.isEmpty() }?.let { src.getSearchManga(1, it, filters) } ?: found
            }.toJson()
            "update" -> {
                val input = mangaFrom(req["manga"]!!.jsonObject)
                val u = source().getMangaUpdate(
                    input,
                    req["chapters"]?.jsonArray?.map { chapterFrom(it.jsonObject) } ?: emptyList(),
                    req["needsDetails"]?.jsonPrimitive?.booleanOrNull ?: true,
                    req["needsChapters"]?.jsonPrimitive?.booleanOrNull ?: true,
                )
                buildJsonObject {
                    // Like Mihon, keep the series' own URL and title when the details leave them out.
                    if (runCatching { u.manga.url }.isFailure) u.manga.url = input.url
                    if (runCatching { u.manga.title }.isFailure) u.manga.title = input.title
                    put("manga", u.manga.toJson())
                    put("chapters", JsonArray(u.chapters.map { it.toJson() }))
                }
            }
            "pages" -> JsonArray(source().getPageList(chapterFrom(req["chapter"]!!.jsonObject)).map { it.toJson() })
            // Downloads through the source's client so its interceptors (decryption, auth) run, then replies with the file path.
            "download" -> {
                val src = source() as? HttpSource ?: throw IllegalArgumentException("not an HttpSource")
                val request = (req["page"] as? JsonObject)?.let { p ->
                    val page = Page(p["index"]!!.jsonPrimitive.int, p.s("url") ?: "", p.s("imageUrl"))
                    if (page.imageUrl == null) page.imageUrl = src.getImageUrl(page)
                    src.hostImageRequest(page)
                } ?: GET(str("url"), src.headers)
                val file = File.createTempFile("img", ".bin", downloadsDir())
                try {
                    src.client.newCall(request).awaitSuccess().use { res ->
                        file.sink().buffer().use { it.writeAll(res.body.source()) }
                    }
                } catch (e: Throwable) {
                    file.delete()
                    throw e
                }
                JsonPrimitive(file.path)
            }
            "setCookies" -> {
                val url = str("url").toHttpUrl()
                Injekt.get<NetworkHelper>().cookieJar.add(url, req["cookies"]!!.jsonArray.map { it.jsonPrimitive.content })
                JsonPrimitive(true)
            }
            // A browser with this user agent passed the challenge, so use it for the site from now on.
            "setUserAgent" -> {
                Injekt.get<NetworkHelper>().userAgents.set(str("url").toHttpUrl().host, str("userAgent"))
                JsonPrimitive(true)
            }
            // The site refuses OkHttp even with the browser's cookies, so its requests go through a browser view.
            "browserOnly" -> {
                BrowserFetch.add(str("url").toHttpUrl().host)
                JsonPrimitive(true)
            }
            "settings" -> settingsOf(source())
            "setSetting" -> setSetting(source(), str("key"), req["value"] ?: JsonNull)
            "cookies" -> JsonArray(Injekt.get<NetworkHelper>().cookieJar.loadForRequest(str("url").toHttpUrl()).map { JsonPrimitive("${it.name}=${it.value}") })
            else -> throw IllegalArgumentException("unknown op")
        }
    }

    /** Loads a jar after checking it's signed by [signingKey]. */
    private fun load(jar: File, signingKey: String): List<Source> {
        val manifest = JarFile(jar, true).use { jf ->
            val signers = mutableSetOf<String>()
            for (entry in jf.entries()) {
                if (entry.isDirectory || entry.name.startsWith("META-INF/")) continue
                jf.getInputStream(entry).use { it.readAllBytes() } // reading verifies the entry's digest
                val certs = entry.codeSigners?.map { it.signerCertPath.certificates.first() }
                    ?: throw SecurityException("unsigned entry ${entry.name}")
                certs.forEach { signers += sha256(it.encoded) }
            }
            if (signers != setOf(signingKey.lowercase())) throw SecurityException("signer $signers does not match $signingKey")
            jf.getInputStream(jf.getEntry("AndroidManifest.xml") ?: throw IllegalArgumentException("no AndroidManifest.xml"))
                .use { it.readAllBytes().toString(Charsets.UTF_8) }
        }
        val pkg = Regex("""package="([^"]+)"""").find(manifest)?.groupValues?.get(1)
        val entry = Regex("""android:name="tachiyomi\.extension\.class"\s+android:value="([^"]+)"""").find(manifest)
            ?.groupValues?.get(1) ?: throw IllegalArgumentException("no tachiyomi.extension.class in manifest")
        // One class loader per jar, never closed. Fine while updates need a restart.
        val loader = URLClassLoader(arrayOf(jar.toURI().toURL()), Host::class.java.classLoader)
        val list = entry.split(';').map { if (it.startsWith(".")) pkg + it else it }.flatMap { name ->
            when (val obj = loader.loadClass(name).getDeclaredConstructor().newInstance()) {
                is SourceFactory -> obj.createSources()
                is Source -> listOf(obj)
                else -> throw IllegalArgumentException("$name is not a Source")
            }
        }
        list.forEach { sources[it.id.toString()] = it }
        return list
    }

    private fun sha256(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }
}

private fun downloadsDir() = File(Application().cacheDir, "downloads").apply { mkdirs() }

private fun Source.toJson() = buildJsonObject {
    put("id", id.toString())
    put("name", name)
    put("lang", (this@toJson as? CatalogueSource)?.lang ?: "")
    put("supportsLatest", supportsLatest)
    (this@toJson as? HttpSource)?.let { put("baseUrl", it.baseUrl) }
}

private fun MangasPage.toJson() = buildJsonObject {
    put("mangas", JsonArray(mangas.map { it.toJson() }))
    put("hasNextPage", hasNextPage)
}

private fun SManga.toJson() = buildJsonObject {
    put("url", runCatching { url }.getOrNull())
    put("title", runCatching { title }.getOrNull())
    put("thumbnailUrl", thumbnail_url)
    put("artist", artist)
    put("author", author)
    put("description", description)
    put("genre", genre)
    put("status", status)
    put("updateStrategy", update_strategy.name)
    put("initialized", initialized)
    put("memo", memo)
}

private fun SChapter.toJson() = buildJsonObject {
    put("url", runCatching { url }.getOrNull())
    put("name", runCatching { name }.getOrNull())
    put("chapterNumber", chapter_number)
    put("scanlator", scanlator)
    put("dateUpload", date_upload)
    put("memo", memo)
}

private fun Page.toJson() = buildJsonObject {
    put("index", index)
    put("url", url)
    put("imageUrl", imageUrl)
}

private fun JsonObject.s(k: String) = (this[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

private fun mangaFrom(o: JsonObject) = SManga.create().apply {
    url = o.s("url") ?: throw IllegalArgumentException("manga.url")
    title = o.s("title") ?: ""
    thumbnail_url = o.s("thumbnailUrl")
    artist = o.s("artist")
    author = o.s("author")
    description = o.s("description")
    genre = o.s("genre")
    status = o["status"]?.jsonPrimitive?.int ?: 0
    update_strategy = o.s("updateStrategy")?.let(UpdateStrategy::valueOf) ?: UpdateStrategy.ALWAYS_UPDATE
    initialized = o["initialized"]?.jsonPrimitive?.boolean ?: false
    (o["memo"] as? JsonObject)?.let { memo = it }
}

private fun chapterFrom(o: JsonObject) = SChapter.create().apply {
    url = o.s("url") ?: throw IllegalArgumentException("chapter.url")
    name = o.s("name") ?: ""
    chapter_number = o["chapterNumber"]?.jsonPrimitive?.float ?: -1f
    scanlator = o.s("scanlator")
    date_upload = o["dateUpload"]?.jsonPrimitive?.long ?: 0
    (o["memo"] as? JsonObject)?.let { memo = it }
}

internal fun otherApostrophe(query: String) = when {
    '\'' in query -> query.replace('\'', '\u2019')
    '\u2019' in query -> query.replace('\u2019', '\'')
    else -> null
}
