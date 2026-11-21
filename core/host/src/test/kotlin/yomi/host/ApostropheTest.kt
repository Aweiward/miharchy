package yomi.host

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class ApostropheTest {
    @Test
    fun straightAndCurlySwapAndOthersStay() {
        assertEquals("barbarian’s", otherApostrophe("barbarian's"))
        assertEquals("barbarian's", otherApostrophe("barbarian’s"))
        assertNull(otherApostrophe("barbarian"))
    }
}
