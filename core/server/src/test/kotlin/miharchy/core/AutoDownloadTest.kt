package miharchy.core

import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals

/** Auto-download's rules (#424), Suwayomi v2.4.2366's `Chapter.downloadNewChapters`, on a database alone. */
class AutoDownloadTest {
    private val db = Database(Files.createTempDirectory("autodl").resolve("core.db"))

    private fun <T> sql(block: (java.sql.Connection) -> T): T = kotlinx.coroutines.runBlocking { db.run(block) }

    private fun set(key: String, value: Boolean) = sql { c ->
        c.update("INSERT INTO metas (scope, owner, key, value) VALUES ('global', 0, ?, ?) ON CONFLICT (scope, owner, key) DO UPDATE SET value = excluded.value", SETTINGS_PREFIX + key, value.toString())
    }

    /** A manga whose chapters are (number, scanlator, read), newest first as a source lists them; returns its id and chapter ids. */
    private fun manga(chapters: List<Triple<Double, String?, Boolean>>, inLibrary: Boolean = true, categories: List<Long> = emptyList()) = sql { c ->
        val id = c.query("INSERT INTO manga (source_id, remote_url, remote_title, user_favorite_at) VALUES (7, ?, 'M', ?) RETURNING id",
            "/m/${System.nanoTime()}", if (inLibrary) 1L else null) { it.getLong(1) }.single()
        c.batch("INSERT INTO manga_category (manga_id, category_id) VALUES (?, ?)", categories.map { listOf(id, it) })
        id to chapters.mapIndexed { i, (n, scan, read) ->
            c.query("INSERT INTO chapter (manga_id, remote_url, remote_name, remote_scanlator, remote_chapter_number, remote_order, state_date_fetch, user_read) VALUES (?, ?, '', ?, ?, ?, 0, ?) RETURNING id",
                id, "/c/$i", scan, n, i, if (read) 1 else 0) { it.getLong(1) }.single()
        }
    }

    private fun category(include: String) = sql { c ->
        c.query("INSERT INTO category (name, `order`, include_in_download) VALUES (?, (SELECT max(`order`) + 1 FROM category), ?) RETURNING id", "c${System.nanoTime()}", include) { it.getLong(1) }.single()
    }

    private fun pick(manga: Long, added: List<Long>, prevLatest: Double? = 10.0) = sql { c -> autoDownloads(c, manga, added, prevLatest) }

    private fun ch(n: Double, read: Boolean = false, scan: String? = null) = Triple(n, scan, read)

    @Test
    fun newChaptersQueueOldestFirstOnlyWhenTheSettingIsOn() {
        val (m, ids) = manga(listOf(ch(12.0), ch(11.0), ch(10.0, read = true)))
        assertEquals(emptyList(), pick(m, ids.take(2)), "the setting is off by default")
        set("autoDownloadNewChapters", true)
        assertEquals(listOf(ids[1], ids[0]), pick(m, ids.take(2)))
        assertEquals(emptyList(), pick(m, ids.take(2), prevLatest = null), "a first fetch downloads nothing")
        assertEquals(emptyList(), pick(m, emptyList()))
        val (out, outIds) = manga(listOf(ch(2.0), ch(1.0, read = true)), inLibrary = false)
        assertEquals(emptyList(), pick(out, outIds.take(1)), "a manga outside the library")
    }

    @Test
    fun theUnreadFilterSkipsAMangaWithAnOlderUnreadChapter() {
        set("autoDownloadNewChapters", true)
        val (m, ids) = manga(listOf(ch(12.0), ch(11.0), ch(10.0, read = true)))
        assertEquals(emptyList(), pick(m, ids.take(1)), "chapter 11 is unread and not new")
        set("excludeEntryWithUnreadChapters", false)
        assertEquals(listOf(ids[0]), pick(m, ids.take(1)))
    }

    @Test
    fun theCategoryRuleIsSuwayomis() {
        set("autoDownloadNewChapters", true)
        val (plain, plainIds) = manga(listOf(ch(11.0), ch(10.0, read = true)))
        assertEquals(1, pick(plain, plainIds.take(1)).size, "no category is Default, UNSET")
        val excluded = category("EXCLUDE")
        val unset = category("UNSET")
        val (both, bothIds) = manga(listOf(ch(11.0), ch(10.0, read = true)), categories = listOf(excluded, unset))
        assertEquals(emptyList(), pick(both, bothIds.take(1)), "EXCLUDE wins")
        val (inUnset, unsetIds) = manga(listOf(ch(11.0), ch(10.0, read = true)), categories = listOf(unset))
        assertEquals(1, pick(inUnset, unsetIds.take(1)).size)
        val included = category("INCLUDE")
        assertEquals(emptyList(), pick(inUnset, unsetIds.take(1)), "with an INCLUDE category, UNSET ones no longer count")
        assertEquals(emptyList(), pick(plain, plainIds.take(1)), "nor does Default")
        val (inIncluded, incIds) = manga(listOf(ch(11.0), ch(10.0, read = true)), categories = listOf(included))
        assertEquals(1, pick(inIncluded, incIds.take(1)).size)
    }

    @Test
    fun reUploadsAndTwinsFromOtherScanlators() {
        set("autoDownloadNewChapters", true)
        // New: 11 from A and B, a 9 (a re-upload) and an unnumbered extra; 10 was the newest before.
        val (m, ids) = manga(listOf(ch(11.0, scan = "B"), ch(11.0, scan = "A"), ch(-1.0, scan = "A"), ch(9.0, scan = "A"), ch(10.0, read = true, scan = "A")))
        val new = ids.take(4)
        // Oldest first is 9 (A), so A wins chapter 11.
        assertEquals(listOf(ids[3], ids[2], ids[1]), pick(m, new))
        set("autoDownloadIgnoreReUploads", true)
        // Without 9 and the unnumbered one, the oldest new chapter is 11 from A.
        assertEquals(listOf(ids[1]), pick(m, new))
    }
}
