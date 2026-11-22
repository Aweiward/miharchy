package miharchy.sync

import kotlin.test.Test
import kotlin.test.assertEquals

private const val SOURCE = 2499283573021220255L
private val KNOWN = MangaKey(SOURCE, "/manga/known")
private val NEW = MangaKey(SOURCE, "/manga/new")
private val IDLE = MangaKey(SOURCE, "/manga/idle")

/** The desktop knows the two oldest chapters of KNOWN, at page 8. */
private val desktop = Library(
    mapOf(
        KNOWN to MangaState("known", inLibrary = false, categories = emptySet(), chapters = mapOf("/c3" to ChapterState(lastPageRead = 8), "/c4" to ChapterState())),
        IDLE to MangaState("idle", inLibrary = true, categories = emptySet(), chapters = emptyMap()),
    ),
)

class AppliedTest {
    @Test fun `a change counts as applied only once the desktop shows it`() {
        val after = desktop.copy(
            manga = desktop.manga + (KNOWN to desktop.manga.getValue(KNOWN).copy(chapters = mapOf("/c3" to ChapterState(lastPageRead = 2)))),
            categories = listOf("A"),
        )
        assertEquals(
            listOf(true, true, false, false, false),
            listOf(SetLastPage(KNOWN, "/c3", 2), CreateCategory("A"), CreateCategory("B"), MarkRead(KNOWN, "/c0"), ImportManga(NEW, "new"))
                .map { it.isAppliedTo(after) },
        )
    }

    @Test fun `a track change counts as applied only once the desktop shows it`() {
        val track = TrackState(remoteId = 30013, lastChapterRead = 4F)
        val after = Library(mapOf(IDLE to MangaState("idle", true, emptySet(), emptyMap(), mapOf(2 to track))))
        assertEquals(
            listOf(true, true, false, false, true),
            listOf(BindTrack(IDLE, 2, track), UpdateTrack(IDLE, 2, track), UpdateTrack(IDLE, 2, track.copy(score = 1F)), UnbindTrack(IDLE, 2), UnbindTrack(IDLE, 1))
                .map { it.isAppliedTo(after) },
        )
    }
}
