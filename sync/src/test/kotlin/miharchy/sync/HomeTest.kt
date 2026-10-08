package miharchy.sync

import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class HomeTest {
    private val dir = Files.createTempDirectory("home-test")
    private val home = Files.createDirectory(dir.resolve("home")).toString()

    @Test fun `an unset or empty HOME never stops the helper`() {
        assertNull(homeMismatch(null, home))
        assertNull(homeMismatch("", home))
    }

    @Test fun `HOME and user home that name the same folder agree`() {
        assertNull(homeMismatch(home, home))
        assertNull(homeMismatch("$home/", home))
        assertNull(homeMismatch("$dir/other/../home", home))
        val link = Files.createSymbolicLink(dir.resolve("link"), dir.resolve("home"))
        assertNull(homeMismatch(link.toString(), home))
    }

    @Test fun `a scratch home that does not exist yet still compares by its normalized path`() {
        assertNull(homeMismatch("$dir/scratch/./", "$dir/scratch"))
    }

    @Test fun `HOME and user home that name different folders stop the helper`() {
        val scratch = Files.createDirectory(dir.resolve("scratch-run")).toString()
        assertEquals(
            "HOME is $scratch but Java's user.home is $home. A verify run sets both (qs.sh env); a normal run sets neither.",
            homeMismatch(scratch, home),
        )
        assertEquals(
            "HOME is $home but Java's user.home is $scratch. A verify run sets both (qs.sh env); a normal run sets neither.",
            homeMismatch(home, scratch),
        )
    }
}
