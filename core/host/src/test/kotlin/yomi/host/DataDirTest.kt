package yomi.host

import android.content.Context
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.nio.file.attribute.PosixFilePermissions

class DataDirTest {
    // Cookies (logins, Cloudflare clearances) and source settings live in the data folder.
    @Test
    fun dataFolderIsOwnerOnlyEvenWhenItExisted() {
        val dir = Files.createTempDirectory("host").resolve("data")
        Files.createDirectories(dir, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwxr-xr-x")))
        Context.setDataDir(dir.toFile())
        assertEquals("rwx------", PosixFilePermissions.toString(Files.getPosixFilePermissions(dir)))
    }
}
