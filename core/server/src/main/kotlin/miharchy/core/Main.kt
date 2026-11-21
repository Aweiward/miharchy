package miharchy.core

import io.ktor.server.cio.CIO
import io.ktor.server.engine.embeddedServer
import yomi.host.startHost
import java.nio.file.Path

/**
 * miharchy-core (ADR 0009, ADR 0010). Each path and the port can be overridden, so tests and
 * development never touch the real folders: MIHARCHY_CORE_DATA, MIHARCHY_CORE_CONFIG, MIHARCHY_CORE_PORT.
 */
fun main() {
    val home = Path.of(System.getProperty("user.home"))
    val data = ownerOnlyDir(System.getenv("MIHARCHY_CORE_DATA")?.let(Path::of) ?: home.resolve(".local/share/miharchy/core"))
    val configFile = System.getenv("MIHARCHY_CORE_CONFIG")?.let(Path::of) ?: home.resolve(".config/miharchy/core.json")
    val port = System.getenv("MIHARCHY_CORE_PORT")?.toInt() ?: 4591

    val config = loadOrCreateConfig(configFile, port)
    startHost(data.resolve("host").toFile())
    val core = Core(config.secret, Database(data.resolve("core.db")))
    System.err.println("miharchy-core: listening on 127.0.0.1:$port")
    embeddedServer(CIO, host = "127.0.0.1", port = port) { api(core) }.start(wait = true)
}
