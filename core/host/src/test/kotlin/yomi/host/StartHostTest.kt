package yomi.host

import eu.kanade.tachiyomi.network.NetworkHelper
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.get
import java.nio.file.Files

class StartHostTest {
    private val dir = TestHostDir.dir

    @Test
    fun startsOncePerJvm() {
        startHost(dir)
        startHost(dir)
        assertNotNull(Injekt.get<NetworkHelper>())
        assertThrows<IllegalArgumentException> { startHost(Files.createTempDirectory("other").toFile()) }
    }
}

/** Tests share one JVM, and the host one folder, so every test that starts the host uses this one. */
object TestHostDir {
    val dir: java.io.File by lazy { Files.createTempDirectory("host-start").toFile() }
}
