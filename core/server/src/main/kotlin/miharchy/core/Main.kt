package miharchy.core

import io.ktor.server.cio.CIO
import io.ktor.server.engine.embeddedServer
import eu.kanade.tachiyomi.data.track.anilist.Anilist
import eu.kanade.tachiyomi.data.track.bangumi.Bangumi
import eu.kanade.tachiyomi.data.track.kitsu.Kitsu
import eu.kanade.tachiyomi.data.track.mangabaka.MangaBaka
import eu.kanade.tachiyomi.data.track.mangaupdates.MangaUpdates
import eu.kanade.tachiyomi.data.track.myanimelist.MyAnimeList
import eu.kanade.tachiyomi.data.track.shikimori.Shikimori
import yomi.host.startHost
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Path

/**
 * miharchy-core (ADR 0009, ADR 0010). Each path and the port can be overridden, so tests and
 * development never touch the real folders: MIHARCHY_CORE_DATA, MIHARCHY_CORE_CONFIG, MIHARCHY_CORE_PORT.
 */
fun main() {
    val home = Path.of(System.getProperty("user.home"))
    val data = ownerOnlyDir(System.getenv("MIHARCHY_CORE_DATA")?.let(Path::of) ?: home.resolve(".local/share/miharchy/core"))
    val configFile = System.getenv("MIHARCHY_CORE_CONFIG")?.let(Path::of) ?: home.resolve(".config/miharchy/core.json")
    // The port of a new core.json; after that, the file's url is the one source of the port,
    // because every client reads it from there.
    val asked = System.getenv("MIHARCHY_CORE_PORT")?.toInt()
    val config = loadOrCreateConfig(configFile, asked ?: 4591)
    val port = java.net.URI(config.url).port
    require(asked == null || asked == port) { "MIHARCHY_CORE_PORT is $asked, but $configFile says ${config.url}" }
    val db = Database(data.resolve("core.db"))
    // One host per JVM: every slice gets this one, because each Host has its own source map.
    val host = startHost(data.resolve("host").toFile())
    val extensions = Extensions(db, host, data.resolve("extensions"))
    runBlocking { extensions.start() }
    val browse = Browse(db, host, extensions, data.resolve("covers"), data.resolve("downloads"))
    val library = Library(db, extensions)
    val downloads = Downloads(db, browse, extensions, data.resolve("downloads"))
    val updates = Updates(db, { browse.refresh(it) })
    val trackerStore = TrackerStore(db)
    val http = okhttp3.OkHttpClient()
    val clients = listOf(
        MyAnimeList(http, trackerStore.of(1)), Anilist(http, trackerStore.of(2)), Kitsu(http, trackerStore.of(3)), Shikimori(http, trackerStore.of(4)),
        Bangumi(http, trackerStore.of(5)), MangaUpdates(http, trackerStore.of(7)), MangaBaka(http, trackerStore.of(11)),
    )
    val trackers = Trackers(db, clients)
    // No host and no tracker client: a sync never contacts a source or a tracker.
    val sync = Sync(db, data.resolve("sync"), config.url, clients.map { it.id.toInt() }.toSet(), installedSources = {
        extensions.sources().associate { it.getValue("id").jsonPrimitive.content.toLong() to it.getValue("name").jsonPrimitive.content }
    }, trackerLogins = { clients.associate { it.id.toInt() to (it.name to it.isLoggedIn) } })
    val settings = Settings(db, data.resolve("covers"))
    Backups(db, sync, data.resolve("backups"))
    val slices = listOf(extensions.routes, browse.routes, library.routes, downloads.routes, updates.routes, trackers.routes, sync.routes, settings.routes)
    val others = slices.reduce { a, b -> a + b }
    // The move calls the other slices' routes, so its parts pass their checks.
    val move = Move(db, downloads, data, data.resolve("sync")) { route, body -> others.getValue(route)(body) }
    val all = slices + listOf(move.routes)
    // A + B silently keeps one of two routes with the same name.
    check(all.sumOf { it.size } == all.flatMap { it.keys }.toSet().size) { "two slices define the same route" }
    val core = Core(config.secret, db, routes = others + move.routes, topics = mapOf("downloads" to downloads.status, "updates" to updates.status), images = browse.images)
    System.err.println("miharchy-core: listening on 127.0.0.1:$port")
    embeddedServer(CIO, host = "127.0.0.1", port = port) { api(core) }.start(wait = true)
}
