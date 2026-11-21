package yomi.host

import eu.kanade.tachiyomi.network.NetworkHelper
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.get
import java.nio.file.Files

class StartHostTest {
    // Tests share one JVM, so one folder serves them all.
    private val dir = Files.createTempDirectory("host-start").toFile()

    @Test
    fun startsOncePerJvm() {
        startHost(dir)
        startHost(dir)
        assertNotNull(Injekt.get<NetworkHelper>())
        assertThrows<IllegalArgumentException> { startHost(Files.createTempDirectory("other").toFile()) }
    }
}
