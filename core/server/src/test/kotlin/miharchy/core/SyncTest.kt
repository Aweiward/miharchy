package miharchy.core

import miharchy.sync.Library
import miharchy.sync.merge
import kotlin.test.Test
import kotlin.test.assertEquals

class SyncTest {
    @Test fun `core links sync's merge`() {
        assertEquals(emptyList(), merge(null, Library.EMPTY, Library.EMPTY, null))
    }
}
