package miharchy.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.attribute.PosixFilePermissions
import java.security.SecureRandom

/** Creates [dir] with mode 700, or repairs the mode of one that exists. */
fun ownerOnlyDir(dir: Path): Path {
    Files.createDirectories(dir)
    Files.setPosixFilePermissions(dir, PosixFilePermissions.fromString("rwx------"))
    return dir
}

/** `~/.config/miharchy/core.json`: where core listens and the secret every request carries (ADR 0010). */
@Serializable
data class CoreConfig(val url: String, val secret: String)

/**
 * Reads the config, or creates it with a new secret. The file is born mode 600, never chmodded
 * after the secret is in it, and its mode is repaired on each start.
 */
fun loadOrCreateConfig(file: Path, port: Int): CoreConfig {
    // Only a folder core creates is made 700: the parent may be shared, such as /tmp or $HOME.
    if (!Files.exists(file.parent)) ownerOnlyDir(file.parent)
    if (!Files.exists(file)) {
        val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val config = CoreConfig("http://127.0.0.1:$port", bytes.joinToString("") { "%02x".format(it) })
        val tmp = file.resolveSibling(file.fileName.toString() + ".tmp")
        Files.deleteIfExists(tmp)
        Files.createFile(tmp, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")))
        Files.writeString(tmp, Json.encodeToString(config))
        Files.move(tmp, file, StandardCopyOption.ATOMIC_MOVE)
    }
    Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-------"))
    return Json.decodeFromString<CoreConfig>(Files.readString(file))
}
