package miharchy.sync

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

private fun key(i: Int) = MangaKey(1L, "/manga/$i")
private fun removals(n: Int) = (1..n).map { RemoveFromLibrary(key(it), "M$it") }
private fun unread(n: Int) = (1..n).map { MarkUnread(key(1), "/c$it") }

class HoldTest {
    @Test fun `a few removals never hold, even from a small library`() {
        assertFalse(holds(removals(4), 10))
    }

    @Test fun `five removals hold from a library of fifty, not of sixty`() {
        assertTrue(holds(removals(5), 50))
        assertFalse(holds(removals(5), 60))
    }

    @Test fun `three removals of 216 do not hold, an emptied library does`() {
        assertFalse(holds(removals(3), 216))
        assertTrue(holds(removals(216), 216))
    }

    @Test fun `fifty chapters marked unread hold, forty-nine do not`() {
        assertFalse(holds(unread(49), 216))
        assertTrue(holds(unread(50), 216))
    }

    @Test fun `other changes never hold`() {
        assertFalse(holds((1..500).map { MarkRead(key(1), "/c$it") } + removals(4), 4))
    }
}
