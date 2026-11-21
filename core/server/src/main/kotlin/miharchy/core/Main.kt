package miharchy.core

import io.ktor.server.cio.CIO
import io.ktor.server.engine.embeddedServer
import yomi.host.startHost
import kotlinx.coroutines.runBlocking
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
    val core = Core(config.secret, db, routes = extensions.routes)
    System.err.println("miharchy-core: listening on 127.0.0.1:$port")
    embeddedServer(CIO, host = "127.0.0.1", port = port) { api(core) }.start(wait = true)
}
