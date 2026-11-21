package miharchy.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import yomi.host.Host
import java.io.IOException
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.time.Duration

/** A repo's index.json, the format Mihon calls an extension store. */
data class Store(val indexUrl: String, val name: String, val badgeLabel: String, val signingKey: String, val website: String, val discord: String?)

/** An extension a repo offers. */
data class Offer(
    val pkgName: String, val name: String, val lang: String, val versionName: String, val versionCode: Long,
    val contentWarning: String, val iconUrl: String, val jarUrl: String, val indexUrl: String,
)

/** An installed extension, kept beside its jar, with the key the jar was checked against. */
@Serializable
data class Installed(
    val pkgName: String, val name: String, val lang: String, val versionName: String, val versionCode: Long,
    val contentWarning: String, val iconUrl: String, val indexUrl: String, val signingKey: String, val jar: String,
)

private val PACKAGE = Regex("""^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$""")
private val KEY = Regex("^[0-9a-f]{64}$")
private const val INDEX_BYTES = 32L shl 20
private const val JAR_BYTES = 64L shl 20

/**
 * The address of a repo's index.json, from any address a user pastes: the repo folder,
 * `index.min.json`, `repo.json`, `index.pb` or `index.json`. Add and remove both go through it.
 */
fun indexUrlOf(input: String): String {
    val url = input.trim()
    if (!Regex("^https?://\\S+$").matches(url)) throw ApiError(Kind.invalid, "Enter a repo URL that starts with http:// or https://.")
    val base = url.trimEnd('/').removeSuffix("/index.min.json").removeSuffix("/index.json").removeSuffix("/repo.json").removeSuffix("/index.pb")
    return "$base/index.json"
}

/** Reads a repo's index.json. Anything in it is untrusted: it names files, addresses and code that runs here. */
fun parseIndex(indexUrl: String, text: String): Pair<Store, List<Offer>> {
    val root = runCatching { Json.parseToJsonElement(text).jsonObject }.getOrNull()
        ?: throw ApiError(Kind.invalid, "$indexUrl is not a Mihon extension repo index.")
    fun JsonObject.s(k: String) = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
    val key = root.s("signingKey")?.lowercase()?.takeIf { KEY.matches(it) }
        ?: throw ApiError(Kind.invalid, "$indexUrl lists no signing key, so its extensions cannot be checked.")
    val contact = root["contact"] as? JsonObject
    val store = Store(indexUrl, root.s("name") ?: "Repo", root.s("badgeLabel") ?: "", key, contact?.s("website") ?: "", contact?.s("discord"))
    val list = ((root["extensionList"] as? JsonObject)?.get("extensions") as? JsonArray).orEmpty().mapNotNull { e ->
        val o = e as? JsonObject ?: return@mapNotNull null
        val pkg = o.s("packageName")?.takeIf { PACKAGE.matches(it) } ?: return@mapNotNull null
        val resources = o["resources"] as? JsonObject
        val jar = resources?.s("jarUrl")?.takeIf { it.startsWith("https://") || it.startsWith("http://") } ?: return@mapNotNull null
        Offer(
            pkgName = pkg,
            name = (o.s("name") ?: pkg).removePrefix("Tachiyomi: "),
            // Mihon's packages name their language: eu.kanade.tachiyomi.extension.<lang>.<name>.
            lang = pkg.split('.').dropLast(1).last(),
            versionName = o.s("versionName") ?: "",
            versionCode = o.s("versionCode")?.toLongOrNull() ?: 0,
            contentWarning = (o.s("contentWarning") ?: "CONTENT_WARNING_SAFE").removePrefix("CONTENT_WARNING_"),
            iconUrl = resources.s("iconUrl")?.takeIf { it.startsWith("https://") } ?: "",
            jarUrl = jar,
            indexUrl = indexUrl,
        )
    }
    if (list.isEmpty()) throw ApiError(Kind.invalid, "$indexUrl has no desktop (.jar) builds, so Miharchy cannot use its extensions.")
    return store to list
}

/**
 * Extension repos and installed extensions (#364). Jars live in [dir] as `<pkg>-<versionCode>.jar`,
 * each beside `<pkg>.json`, an [Installed]. A jar loads only with the key pinned for it at install.
 */
class Extensions(private val db: Database, private val host: Host, private val dir: Path) {
    private val http = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL).connectTimeout(Duration.ofSeconds(20)).build()
    private val lock = Mutex()
    private val offers = mutableMapOf<String, List<Offer>>() // per index URL, the last list fetched
    private val loaded = mutableMapOf<String, List<JsonObject>>() // per package, the sources the host loaded

    init { ownerOnlyDir(dir) }

    val routes: Map<String, Route> = mapOf(
        "extensionRepo.list" to { _ -> buildJsonObject { put("repos", JsonArray(stores().map(::repoJson))) } },
        "extensionRepo.add" to { input -> buildJsonObject { put("repo", repoJson(addStore(input.str("url")))) } },
        "extensionRepo.remove" to { input -> buildJsonObject { put("repo", buildJsonObject { put("indexUrl", removeStore(input.str("url"))) }) } },
        "extension.list" to { _ -> list() },
        "extension.install" to { input -> buildJsonObject { put("extension", install(input.str("pkgName"), update = false)) } },
        "extension.update" to { input -> buildJsonObject { put("extension", install(input.str("pkgName"), update = true)) } },
        "extension.updateAll" to { input ->
            val names = (input["pkgNames"] as? JsonArray)?.map { it.jsonPrimitive.content }
            buildJsonObject { put("extensions", JsonArray(updateAll(names))) }
        },
        "extension.remove" to { input -> buildJsonObject { put("extension", remove(input.str("pkgName"))) } },
    )

    /** Loads every installed extension. One that fails is logged and skipped, so core still starts. */
    suspend fun start() = lock.withLock {
        for (meta in installed()) {
            runCatching { load(meta.pkgName, dir.resolve(meta.jar), meta.signingKey) }
                .onFailure { System.err.println("miharchy-core: skipped ${meta.pkgName}: ${it.message}") }
        }
    }

    /** The loaded sources, with their extension's icon and content warning, as the Browse view reads them. */
    suspend fun sources(): List<JsonObject> = lock.withLock {
        installed().flatMap { m ->
            loaded[m.pkgName].orEmpty().map { s ->
                val lang = s["lang"]!!.jsonPrimitive.content
                buildJsonObject {
                    put("id", s.id())
                    put("displayName", displayName(s))
                    put("name", s["name"]!!); put("lang", lang)
                    put("iconUrl", m.iconUrl); put("contentWarning", m.contentWarning)
                    put("supportsLatest", s["supportsLatest"]!!); put("isConfigurable", s["configurable"]!!)
                }
            }
        }
    }

    private suspend fun stores(): List<Store> = db.run { c ->
        c.createStatement().use { s ->
            s.executeQuery("SELECT index_url, name, badge_label, signing_key, contact_website, contact_discord FROM extension_store ORDER BY name").use { r ->
                generateSequence { if (r.next()) Store(r.getString(1), r.getString(2), r.getString(3), r.getString(4), r.getString(5), r.getString(6)) else null }.toList()
            }
        }
    }

    private suspend fun fetchIndex(indexUrl: String): Pair<Store, List<Offer>> {
        val text = get(indexUrl, INDEX_BYTES) { status -> if (status == 404) ApiError(Kind.invalid, "$indexUrl was not found, so this is not a repo with desktop (.jar) builds.") else null }
        return parseIndex(indexUrl, text.toString(Charsets.UTF_8))
    }

    private suspend fun addStore(url: String): Store {
        val (store, list) = fetchIndex(indexUrlOf(url))
        return lock.withLock {
            val known = stores().firstOrNull { it.indexUrl == store.indexUrl }
            if (known != null) {
                if (known.signingKey != store.signingKey) throw ApiError(Kind.invalid, "${store.indexUrl} now lists another signing key than when it was added. Remove the repo and add it again only if you trust the change.")
                return@withLock known
            }
            db.run { c ->
                c.prepareStatement("INSERT INTO extension_store VALUES (?, ?, ?, ?, ?, ?, 0, NULL)").use { p ->
                    listOf(store.indexUrl, store.name, store.badgeLabel, store.signingKey, store.website, store.discord).forEachIndexed { i, v -> p.setString(i + 1, v) }
                    p.executeUpdate()
                }
            }
            offers[store.indexUrl] = list
            store
        }
    }

    /** Installed extensions stay installed, as in Mihon; they show as obsolete. */
    private suspend fun removeStore(url: String): String = lock.withLock {
        val indexUrl = indexUrlOf(url)
        db.run { c -> c.prepareStatement("DELETE FROM extension_store WHERE index_url = ?").use { it.setString(1, indexUrl); it.executeUpdate() } }
        offers.remove(indexUrl)
        indexUrl
    }

    /** Fetches every repo. A repo that fails keeps its last list, so its extensions never look obsolete for it. */
    private suspend fun list(): JsonObject {
        val all = stores()
        val errors = mutableListOf<JsonObject>()
        for (store in all) {
            try {
                val (fresh, list) = fetchIndex(store.indexUrl)
                if (fresh.signingKey != store.signingKey) throw ApiError(Kind.invalid, "${store.indexUrl} now lists another signing key than when it was added.")
                lock.withLock { offers[store.indexUrl] = list }
            } catch (e: ApiError) {
                errors += buildJsonObject { put("indexUrl", store.indexUrl); put("message", e.message.orEmpty()) }
            }
        }
        return lock.withLock {
            buildJsonObject {
                put("repos", JsonArray(all.map(::repoJson)))
                put("extensions", JsonArray(rows(all)))
                put("errors", JsonArray(errors))
            }
        }
    }

    private fun rows(stores: List<Store>): List<JsonObject> {
        val mine = installed().associateBy { it.pkgName }
        val known = stores.map { it.indexUrl }.toSet()
        val offered = linkedMapOf<String, Offer>()
        for (store in stores) for (o in offers[store.indexUrl].orEmpty()) {
            // The same package in two repos: the one it was installed from wins.
            if (o.pkgName !in offered || mine[o.pkgName]?.indexUrl == o.indexUrl) offered[o.pkgName] = o
        }
        val rows = offered.values.map { extensionJson(it, mine[it.pkgName]) }
        val obsolete = mine.values.filter { it.pkgName !in offered && (it.indexUrl !in known || offers[it.indexUrl] != null) }
        return rows + obsolete.map { extensionJson(null, it) }
    }

    private suspend fun install(pkgName: String, update: Boolean): JsonObject {
        if (!PACKAGE.matches(pkgName)) throw ApiError(Kind.invalid, "$pkgName is not a package name.")
        val offer = lock.withLock { offerFor(pkgName) } ?: run { list(); lock.withLock { offerFor(pkgName) } }
            ?: throw ApiError(Kind.notFound, "No repo offers $pkgName.")
        val store = stores().firstOrNull { it.indexUrl == offer.indexUrl } ?: throw ApiError(Kind.notFound, "The repo of $pkgName was removed.")
        val bytes = get(offer.jarUrl, JAR_BYTES) { null }
        return lock.withLock {
            val old = meta(pkgName)
            if (update && old == null) throw ApiError(Kind.invalid, "$pkgName is not installed.")
            if (!update && old != null) return@withLock extensionJson(offer, old)
            if (old != null && old.versionCode >= offer.versionCode) return@withLock extensionJson(offer, old)
            // A new name, never the loaded file: the host's class loader keeps the old jar open.
            val jar = dir.resolve("$pkgName-${offer.versionCode}.jar")
            val part = dir.resolve("$pkgName-${offer.versionCode}.part")
            withContext(Dispatchers.IO) { Files.write(part, bytes); Files.move(part, jar, StandardCopyOption.REPLACE_EXISTING) }
            val before = loaded[pkgName].orEmpty().map { it.id() }
            try {
                load(pkgName, jar, store.signingKey)
            } catch (e: Exception) {
                Files.deleteIfExists(jar)
                throw e
            }
            val dropped = before - loaded[pkgName].orEmpty().map { it.id() }.toSet()
            if (dropped.isNotEmpty()) host.handle(buildJsonObject { put("op", "unload"); put("sources", JsonArray(dropped.map(::JsonPrimitive))) })
            val meta = Installed(pkgName, offer.name, offer.lang, offer.versionName, offer.versionCode, offer.contentWarning, offer.iconUrl, offer.indexUrl, store.signingKey, jar.fileName.toString())
            writeMeta(meta)
            if (old != null && old.jar != meta.jar) Files.deleteIfExists(dir.resolve(old.jar))
            extensionJson(offer, meta)
        }
    }

    private suspend fun updateAll(names: List<String>?): List<JsonObject> {
        val due = lock.withLock {
            installed().filter { m -> (names == null || m.pkgName in names) && (offerFor(m.pkgName)?.versionCode ?: 0) > m.versionCode }.map { it.pkgName }
        }
        return due.map { install(it, update = true) }
    }

    private suspend fun remove(pkgName: String): JsonObject = lock.withLock {
        val meta = meta(pkgName) ?: throw ApiError(Kind.notFound, "$pkgName is not installed.")
        val ids = loaded.remove(pkgName).orEmpty().map { it.id() }
        if (ids.isNotEmpty()) host.handle(buildJsonObject { put("op", "unload"); put("sources", JsonArray(ids.map(::JsonPrimitive))) })
        Files.deleteIfExists(dir.resolve(meta.jar))
        Files.deleteIfExists(dir.resolve("$pkgName.json"))
        val offer = offerFor(pkgName)
        if (offer != null) extensionJson(offer, null) else buildJsonObject { put("pkgName", pkgName); put("isInstalled", false) }
    }

    private suspend fun load(pkgName: String, jar: Path, key: String) {
        val sources = try {
            host.handle(buildJsonObject { put("op", "load"); put("jar", jar.toString()); put("signingKey", key) }).jsonArray.map { it.jsonObject }
        } catch (e: SecurityException) {
            throw ApiError(Kind.invalid, "$pkgName is not signed with its repo's key, so it was not loaded: ${e.message}")
        } catch (e: Exception) {
            throw ApiError(Kind.source, "$pkgName failed to load: ${e::class.java.simpleName}: ${e.message}")
        }
        loaded[pkgName] = sources
    }

    private fun offerFor(pkgName: String): Offer? {
        val from = meta(pkgName)?.indexUrl
        val all = offers.values.flatten().filter { it.pkgName == pkgName }
        return all.firstOrNull { it.indexUrl == from } ?: all.firstOrNull()
    }

    private fun meta(pkgName: String): Installed? =
        dir.resolve("$pkgName.json").takeIf(Files::exists)?.let { Json.decodeFromString<Installed>(Files.readString(it)) }

    private fun installed(): List<Installed> = Files.list(dir).use { s ->
        s.filter { it.fileName.toString().endsWith(".json") }.toList()
    }.mapNotNull { runCatching { Json.decodeFromString<Installed>(Files.readString(it)) }.getOrNull() }

    private fun writeMeta(meta: Installed) {
        val tmp = dir.resolve("${meta.pkgName}.json.tmp")
        Files.writeString(tmp, Json.encodeToString(meta))
        Files.move(tmp, dir.resolve("${meta.pkgName}.json"), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
    }

    /** The fields `window/Extensions.js` reads today, plus each installed extension's sources. */
    private fun extensionJson(offer: Offer?, meta: Installed?) = buildJsonObject {
        put("pkgName", offer?.pkgName ?: meta!!.pkgName)
        put("name", offer?.name ?: meta!!.name)
        put("lang", offer?.lang ?: meta!!.lang)
        put("versionName", meta?.versionName ?: offer!!.versionName)
        put("iconUrl", offer?.iconUrl ?: meta!!.iconUrl)
        put("isInstalled", meta != null)
        put("hasUpdate", meta != null && offer != null && offer.versionCode > meta.versionCode)
        put("isObsolete", meta != null && offer == null)
        put("contentWarning", offer?.contentWarning ?: meta!!.contentWarning)
        put("storeIndexUrl", meta?.indexUrl ?: offer!!.indexUrl)
        if (meta != null) put("sources", buildJsonArray {
            for (s in loaded[meta.pkgName].orEmpty()) add(buildJsonObject {
                put("id", s.id()); put("displayName", displayName(s)); put("lang", s["lang"]!!); put("isConfigurable", s["configurable"]!!)
            })
        })
    }

    private fun repoJson(store: Store) = buildJsonObject { put("indexUrl", store.indexUrl); put("name", store.name) }

    private suspend fun get(url: String, cap: Long, onStatus: (Int) -> ApiError?): ByteArray = withContext(Dispatchers.IO) {
        val response = try {
            http.send(HttpRequest.newBuilder(URI(url)).timeout(Duration.ofSeconds(120)).GET().build(), HttpResponse.BodyHandlers.ofInputStream())
        } catch (e: IOException) {
            throw ApiError(Kind.network, "Could not reach $url: ${e.message}")
        }
        response.body().use { body ->
            if (response.statusCode() != 200) throw onStatus(response.statusCode()) ?: ApiError(Kind.network, "$url answered HTTP ${response.statusCode()}.")
            val bytes = body.readNBytes((cap + 1).toInt())
            if (bytes.size > cap) throw ApiError(Kind.invalid, "$url is larger than ${cap shr 20} MB.")
            bytes
        }
    }
}

/** Suwayomi's displayName is the source's toString(): "MangaDex (EN)". */
private fun displayName(s: JsonObject) = "${s["name"]!!.jsonPrimitive.content} (${s["lang"]!!.jsonPrimitive.content.uppercase()})"

private fun JsonObject.id() = this["id"]!!.jsonPrimitive.content

private fun JsonObject.str(key: String) = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
    ?: throw ApiError(Kind.invalid, "The request needs the string $key.")
