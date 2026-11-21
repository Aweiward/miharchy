package miharchy.core

import kotlinx.coroutines.runBlocking
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.PosixFilePermissions
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class FilesTest {
    private val dir = Files.createTempDirectory("core-files")
    private fun mode(p: Path) = PosixFilePermissions.toString(Files.getPosixFilePermissions(p))

    @Test
    fun theConfigIsBornPrivateAndKeepsItsSecret() {
        val file = dir.resolve("miharchy/core.json")
        val first = loadOrCreateConfig(file, 4591)
        assertEquals("rw-------", mode(file))
        assertEquals("rwx------", mode(file.parent))
        assertEquals("http://127.0.0.1:4591", first.url)
        assertEquals(64, first.secret.length)
        Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-r--r--"))
        assertEquals(first, loadOrCreateConfig(file, 4591))
        assertEquals("rw-------", mode(file))
        assertNotEquals(first.secret, loadOrCreateConfig(dir.resolve("other/core.json"), 4591).secret)
    }

    @Test
    fun aSharedFolderKeepsItsMode() {
        val shared = Files.createDirectories(dir.resolve("shared"), PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwxr-xr-x")))
        loadOrCreateConfig(shared.resolve("core.json"), 4591)
        assertEquals("rwxr-xr-x", mode(shared))
        assertEquals("rw-------", mode(shared.resolve("core.json")))
    }

    @Test
    fun anOpenDataFolderIsRepaired() {
        val data = Files.createDirectories(dir.resolve("data"), PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwxr-xr-x")))
        ownerOnlyDir(data)
        assertEquals("rwx------", mode(data))
    }

    @Test
    fun migrationsRunOnce() = runBlocking {
        val file = dir.resolve("core.db")
        Database(file).use { db ->
            assertEquals(1, db.schema)
            db.run { it.createStatement().execute("INSERT INTO metas VALUES ('global', 0, 'k', 'v')") }
        }
        Database(file).use { db ->
            assertEquals(1, db.schema)
            assertEquals("v", db.run { c -> c.createStatement().executeQuery("SELECT value FROM metas").use { it.getString(1) } })
        }
    }

    @Test
    fun aMissingMigrationStopsAfterTheLastGoodOne() {
        val file = dir.resolve("broken.db")
        val thrown = runCatching { Database(file, listOf("0001-metas.sql", "missing.sql")) }
        assertTrue(thrown.isFailure)
        Database(file).use { assertEquals(1, it.schema) }
    }
}
