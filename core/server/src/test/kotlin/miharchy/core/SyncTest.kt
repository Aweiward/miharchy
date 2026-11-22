package miharchy.core

import eu.kanade.tachiyomi.data.backup.models.Backup
import eu.kanade.tachiyomi.data.backup.models.BackupCategory
import eu.kanade.tachiyomi.data.backup.models.BackupChapter
import eu.kanade.tachiyomi.data.backup.models.BackupHistory
import eu.kanade.tachiyomi.data.backup.models.BackupManga
import eu.kanade.tachiyomi.data.backup.models.BackupSource
import eu.kanade.tachiyomi.data.backup.models.BackupTracking
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import miharchy.sync.MangaKey
import miharchy.sync.Summary
import miharchy.sync.decodeBackup
import miharchy.sync.encodeBackup
import miharchy.sync.merge
import miharchy.sync.restoredFrom
import miharchy.sync.toLibrary
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.exists
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readBytes
import kotlin.io.path.writeBytes
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val SOURCE = 2499283573021220255L
private val M = MangaKey(SOURCE, "/manga/m")
private val N = MangaKey(SOURCE, "/manga/n")
private const val MAL = 1
private const val ANILIST = 2

private fun chapter(url: String, read: Boolean = false, page: Long = 0, bookmark: Boolean = false, order: Long = 0) =
    BackupChapter(url = url, name = url, read = read, lastPageRead = page, bookmark = bookmark, sourceOrder = order)

private class TestManga(val chapters: List<BackupChapter>, val favorite: Boolean, val categories: List<String>, val tracks: List<BackupTracking>, val notes: String)

private fun manga(
    key: MangaKey, vararg chapters: BackupChapter, favorite: Boolean = true, categories: List<String> = emptyList(),
    tracks: List<BackupTracking> = emptyList(), notes: String = "",
) = key to TestManga(chapters.toList(), favorite, categories, tracks, notes)

private fun track(tracker: Int = ANILIST, read: Float = 0F, status: Int = 1, score: Float = 0F, start: Long = 0, finish: Long = 0, remoteId: Long = 30013) =
    BackupTracking(
        syncId = tracker, libraryId = 0, mediaId = remoteId, title = "Remote $remoteId", trackingUrl = "https://anilist.co/manga/$remoteId",
        lastChapterRead = read, status = status, score = score, startedReadingDate = start, finishedReadingDate = finish,
    )

/** sync/'s MergeTest builder, as a backup: Mihon references categories by order. */
private fun backup(vararg manga: Pair<MangaKey, TestManga>, categories: List<String> = emptyList()): Backup {
    val names = (categories + manga.flatMap { it.second.categories }).distinct()
    return decodeBackup(encodeBackup(Backup(
        backupManga = manga.map { (key, m) ->
            BackupManga(
                source = key.source, url = key.url, title = key.url, chapters = m.chapters, favorite = m.favorite,
                categories = m.categories.map { names.indexOf(it).toLong() * 10 }, tracking = m.tracks, notes = m.notes,
            )
        },
        backupCategories = names.mapIndexed { i, name -> BackupCategory(name, order = i.toLong() * 10) },
    )))
}

private val EMPTY = backup()

class SyncTest {
    private val work = Files.createTempDirectory("sync")
    private var runs = 0

    @AfterTest fun clean() {
        work.toFile().deleteRecursively()
    }

    private class Core(val db: Database, val sync: Sync, val folder: Path, val state: Path)

    /** A fresh core holding [desktop], loaded the way an import loads it. */
    private fun core(desktop: Backup): Core {
        val dir = work.resolve("run${runs++}")
        val folder = Files.createDirectories(dir.resolve("phone"))
        val db = Database(dir.resolve("core.db"))
        val sync = Sync(db, dir.resolve("state"), "http://127.0.0.1:4591", setOf(1, 2, 3, 4, 5, 7, 11))
        runBlocking { db.run { c -> c.transaction { sync.restore(c, desktop) } } }
        return Core(db, sync, folder, dir.resolve("state"))
    }

    private fun Core.call(route: String, body: JsonObject = JsonObject(emptyMap())) = runBlocking { sync.routes.getValue(route)(body) }.jsonObject

    private fun Core.run(apply: Boolean = true, dryRun: Boolean = false): Summary = Json.decodeFromJsonElement(
        Summary.serializer(),
        call("sync.run", buildJsonObject { put("folder", folder.toString()); put("apply", apply); put("dryRun", dryRun) }),
    )

    private fun Core.library() = runBlocking { db.run { c -> sync.snapshot(c, emptyList()) } }

    /**
     * One sync/ MergeTest case on core's database: core finds the same changes the merge finds on the same backups
     * (so its snapshot reads the desktop right), applies them (apply checks each landed), exports a backup that
     * reads back as core's library, and finds nothing left on a second sync.
     */
    private fun scenario(phoneBase: Backup?, phone: Backup, desktop: Backup, desktopBase: Backup?) {
        val core = core(desktop)
        core.db.use {
            phoneBase?.let { Files.createDirectories(core.state).resolve(Sync.PHONE_BASELINE).writeBytes(encodeBackup(it)) }
            desktopBase?.let { Files.createDirectories(core.state).resolve(Sync.DESKTOP_BASELINE).writeBytes(encodeBackup(it)) }
            core.folder.resolve("app.mihon_2026-11-22_10-00.tachibk").writeBytes(encodeBackup(phone))

            val first = core.run()
            assertEquals(merge(phoneBase?.toLibrary(), phone.toLibrary(), desktop.toLibrary(), desktopBase?.toLibrary()), first.changes)
            val export = Path.of(first.export!!)
            assertEquals(core.library(), decodeBackup(export.readBytes()).toLibrary(), "the export reads back as core's library")
            assertEquals(export.readBytes().toList(), core.state.resolve(Sync.DESKTOP_BASELINE).readBytes().toList())
            assertEquals(emptyList(), core.run().changes, "a second sync finds nothing left")
        }
    }

    // sync/'s MergeTest, case by case, each merge() call in it run through core.

    @Test fun `first sync imports a manga the desktop has never seen, with its categories`() =
        scenario(null, backup(manga(M, chapter("/c1", read = true), categories = listOf("Action"))), EMPTY, null)

    @Test fun `first sync is additive only`() = scenario(
        null,
        backup(manga(M, chapter("/c1"), chapter("/c2", read = true, page = 7), categories = listOf("B")), manga(N, favorite = false)),
        backup(manga(M, chapter("/c1", read = true, page = 5), chapter("/c2"), categories = listOf("A")), manga(N)),
        null,
    )

    @Test fun `a change on the phone only wins, even unread over read`() {
        val base = backup(manga(M, chapter("/c1", read = true, page = 12)))
        scenario(base, backup(manga(M, chapter("/c1"))), base, null)
    }

    @Test fun `a change on the desktop only is kept`() {
        val base = backup(manga(M, chapter("/c1"), categories = listOf("A")))
        scenario(base, base, backup(manga(M, chapter("/c1", read = true, page = 3), categories = listOf("B")), categories = listOf("A")), base)
    }

    @Test fun `without a desktop baseline the phone baseline stands in, so desktop edits survive`() = scenario(
        backup(manga(M, chapter("/c1"), chapter("/c2"))),
        backup(manga(M, chapter("/c1", read = true), chapter("/c2"))),
        backup(manga(M, chapter("/c1"), chapter("/c2", read = true))),
        null,
    )

    @Test fun `both sides changed read state - read beats unread`() {
        val read = backup(manga(M, chapter("/c1", read = true)))
        val unread = backup(manga(M, chapter("/c1")))
        scenario(read, unread, read, unread)
        scenario(unread, read, unread, read)
    }

    @Test fun `a bookmark changed on the phone only wins, added or removed`() {
        val plain = backup(manga(M, chapter("/c1")))
        val marked = backup(manga(M, chapter("/c1", bookmark = true)))
        scenario(plain, marked, plain, plain)
        scenario(marked, plain, marked, marked)
    }

    @Test fun `both sides changed the bookmark - bookmarked wins`() {
        val plain = backup(manga(M, chapter("/c1")))
        val marked = backup(manga(M, chapter("/c1", bookmark = true)))
        scenario(marked, plain, marked, plain)
        scenario(plain, marked, plain, marked)
    }

    @Test fun `both sides changed the last page - the higher value wins`() {
        val base = backup(manga(M, chapter("/c1", page = 2)))
        val phone = backup(manga(M, chapter("/c1", page = 5)))
        scenario(base, phone, backup(manga(M, chapter("/c1", page = 9))), base)
        scenario(base, phone, backup(manga(M, chapter("/c1", page = 4))), base)
    }

    @Test fun `both sides changed categories - union, creating unknown ones by name`() {
        val base = backup(manga(M, categories = listOf("A")))
        scenario(base, backup(manga(M, categories = listOf("B"))), backup(manga(M, categories = listOf("A", "C"))), base)
    }

    @Test fun `every phone category reaches the desktop, empty ones too, in the phone's order`() =
        scenario(null, backup(manga(M, categories = listOf("A")), categories = listOf("C", "A", "B")), backup(manga(M, categories = listOf("A"))), null)

    @Test fun `a category the desktop already has is not created again`() {
        val base = backup(manga(M), manga(N, categories = listOf("A")))
        scenario(base, backup(manga(M, categories = listOf("A")), manga(N, categories = listOf("A"))), base, null)
    }

    @Test fun `a phone removal propagates when the desktop did not change the manga`() {
        val base = backup(manga(M, chapter("/c1", read = true), categories = listOf("A")))
        scenario(base, backup(manga(M, chapter("/c1", read = true), favorite = false)), base, null)
    }

    @Test fun `a phone removal does not propagate when the desktop changed the manga`() = scenario(
        backup(manga(M, chapter("/c1"), categories = listOf("A"))),
        backup(manga(M, chapter("/c1"), favorite = false)),
        backup(manga(M, chapter("/c1", read = true), categories = listOf("A"))),
        null,
    )

    @Test fun `a manga that dropped out of the phone backup is a removal, not an unread mark`() {
        val base = backup(manga(M, chapter("/c1", read = true, page = 4)), manga(N))
        scenario(base, backup(manga(N)), base, null)
    }

    @Test fun `a desktop removal stays unless the phone changed the manga`() {
        val base = backup(manga(M, chapter("/c1")))
        val desktop = backup(manga(M, chapter("/c1"), favorite = false))
        scenario(base, base, desktop, base)
        scenario(base, backup(manga(M, chapter("/c1", read = true))), desktop, base)
    }

    @Test fun `both sides removed the manga`() {
        val base = backup(manga(M, chapter("/c1")))
        val removed = backup(manga(M, chapter("/c1"), favorite = false))
        scenario(base, removed, removed, base)
    }

    @Test fun `a chapter the desktop lacks still gets its change, from the phone's backup`() {
        val base = backup(manga(M, chapter("/c1")))
        scenario(base, backup(manga(M, chapter("/c1"), chapter("/c2", read = true, page = 3))), base, null)
    }

    @Test fun `a new unread chapter on the phone is no change`() {
        val base = backup(manga(M, chapter("/c1")))
        scenario(base, backup(manga(M, chapter("/c1"), chapter("/c2"))), base, null)
    }

    @Test fun `a phone manga outside the library that the desktop never saw is not created`() =
        scenario(null, backup(manga(M, chapter("/c1", read = true), favorite = false)), EMPTY, null)

    @Test fun `a desktop manga outside the library gets added, not imported`() =
        scenario(null, backup(manga(M, chapter("/c1", read = true))), backup(manga(M, chapter("/c1"), favorite = false)), null)

    @Test fun `merging is idempotent once applied`() {
        val phone = backup(manga(M, chapter("/c1"), favorite = false), manga(N, chapter("/c9", read = true)))
        scenario(backup(manga(M, chapter("/c1", read = true))), phone, phone, null)
    }

    @Test fun `first sync binds the phone's tracks, on a new manga and on a known one`() = scenario(
        null,
        backup(manga(M, tracks = listOf(track(read = 4F))), manga(N, tracks = listOf(track(MAL, read = 2F, remoteId = 2)))),
        backup(manga(N)),
        null,
    )

    @Test fun `a tracker the merge does not know is ignored`() =
        scenario(null, backup(manga(M, tracks = listOf(track(tracker = 6, read = 4F)))), backup(manga(M)), null)

    @Test fun `a track changed on the phone only wins, chapters read only ever going up`() {
        val base = backup(manga(M, tracks = listOf(track(read = 4F, status = 1, score = 6F))))
        scenario(base, backup(manga(M, tracks = listOf(track(read = 7F, status = 2, score = 8F)))), base, base)
        scenario(base, backup(manga(M, tracks = listOf(track(read = 1F, status = 2, score = 6F)))), base, base)
    }

    @Test fun `a track changed on the desktop only is kept`() {
        val base = backup(manga(M, tracks = listOf(track(read = 4F))))
        scenario(base, base, backup(manga(M, tracks = listOf(track(read = 9F, status = 2)))), base)
    }

    @Test fun `both sides changed a track - most read, earliest start, latest finish`() {
        val base = backup(manga(M, tracks = listOf(track(read = 4F, status = 1, score = 5F, start = 300))))
        val phone = backup(manga(M, tracks = listOf(track(read = 6F, status = 1, score = 7F, start = 200))))
        scenario(base, phone, backup(manga(M, tracks = listOf(track(read = 9F, status = 2, score = 5F, start = 300, finish = 900)))), base)
        scenario(base, phone, backup(manga(M, tracks = listOf(track(read = 5F, status = 3, score = 2F, start = 300)))), base)
    }

    @Test fun `both sides bound the same tracker on first sync - merged, the phone leading on a tie`() = scenario(
        null,
        backup(manga(M, tracks = listOf(track(read = 3F, status = 1, remoteId = 7)))),
        backup(manga(M, tracks = listOf(track(read = 3F, status = 2, remoteId = 8)))),
        null,
    )

    @Test fun `a phone unbind propagates when the desktop did not change the track`() {
        val base = backup(manga(M, tracks = listOf(track(read = 4F), track(MAL, remoteId = 2))))
        scenario(base, backup(manga(M, tracks = listOf(track(MAL, remoteId = 2)))), base, base)
    }

    @Test fun `an unbind on one side loses to a change on the other`() {
        val base = backup(manga(M, tracks = listOf(track(read = 4F))))
        val unbound = backup(manga(M))
        val raised = backup(manga(M, tracks = listOf(track(read = 6F))))
        scenario(base, unbound, raised, base)
        scenario(base, raised, unbound, base)
    }

    @Test fun `a desktop unbind survives when the phone did not change the track`() {
        val base = backup(manga(M, tracks = listOf(track(read = 4F))))
        scenario(base, base, backup(manga(M)), base)
    }

    @Test fun `a track edit on the desktop keeps a phone removal from propagating`() {
        val base = backup(manga(M, tracks = listOf(track(read = 4F))))
        scenario(base, backup(manga(M, favorite = false, tracks = listOf(track(read = 4F)))), backup(manga(M, tracks = listOf(track(read = 5F)))), base)
    }

    @Test fun `a manga new to the desktop brings its notes`() = scenario(null, backup(manga(M, notes = "Dropped")), EMPTY, null)

    @Test fun `notes changed on the phone only come in, changed on the desktop only stay`() {
        val base = backup(manga(M, notes = "a"))
        scenario(base, backup(manga(M, notes = "b")), base, base)
        scenario(base, backup(manga(M)), base, base)
        scenario(base, base, backup(manga(M, notes = "c")), base)
    }

    @Test fun `notes both sides changed keep both texts, the desktop's first`() {
        val base = backup(manga(M, notes = "a"))
        scenario(base, backup(manga(M, notes = "phone")), backup(manga(M, notes = "desk")), base)
        scenario(base, backup(manga(M, notes = "same")), backup(manga(M, notes = "same")), base)
    }

    @Test fun `track merging is idempotent once applied`() {
        val phone = backup(manga(M, tracks = listOf(track(read = 6F, score = 8F))))
        scenario(backup(manga(M, tracks = listOf(track(read = 4F)))), phone, phone, null)
    }

    // Core's own behavior.

    @Test fun `an imported manga brings the phone's chapters, read state, order and history whole`() {
        val phone = backup(manga(M, chapter("/c2", read = true, order = 0), chapter("/c1", bookmark = true, page = 9, order = 1)))
        phone.backupManga.single().history = listOf(BackupHistory("/c2", lastRead = 1_769_000_000_000, readDuration = 60_000))
        val core = core(EMPTY)
        core.db.use {
            core.folder.resolve("app.mihon_2026-11-22_10-00.tachibk").writeBytes(encodeBackup(phone))
            core.run()
            val rows = runBlocking {
                core.db.run { c ->
                    c.query(
                        """SELECT ch.remote_url, ch.remote_order, ch.user_read, ch.user_bookmark, ch.user_last_page_read, h.read_at, coalesce(h.read_duration, 0)
                           FROM chapter ch LEFT JOIN history h ON h.chapter_id = ch.id ORDER BY ch.remote_order""",
                    ) { r -> listOf(r.getString(1), r.getLong(2), r.getInt(3), r.getInt(4), r.getLong(5), r.getObject(6)?.let { (it as Number).toLong() }, r.getLong(7)) }
                }
            }
            assertEquals(listOf(listOf("/c2", 0L, 1, 0, 0L, 1_769_000_000_000L, 60_000L), listOf("/c1", 1L, 0, 1, 9L, null, 0L)), rows)
        }
    }

    @Test fun `a sync that looks like a lost phone backup holds and changes nothing`() {
        val keys = (1..6).map { MangaKey(SOURCE, "/manga/$it") }
        val full = backup(*keys.map { manga(it, chapter("/c1", read = true)) }.toTypedArray())
        val core = core(full)
        core.db.use {
            Files.createDirectories(core.state).resolve(Sync.PHONE_BASELINE).writeBytes(encodeBackup(full))
            core.folder.resolve("app.mihon_2026-11-22_10-00.tachibk").writeBytes(encodeBackup(EMPTY))
            val before = core.library()
            val held = core.run(apply = false)
            assertTrue(held.held)
            assertNull(held.export)
            val dry = core.run(dryRun = true)
            assertEquals(6, dry.changes.size)
            assertEquals(before, core.library())
            assertEquals(listOf("app.mihon_2026-11-22_10-00.tachibk"), core.folder.listDirectoryEntries().map { it.name })
            assertEquals(listOf(Sync.PHONE_BASELINE), core.state.listDirectoryEntries().map { it.name })
        }
    }

    @Test fun `the desktop backup for the phone carries its marker, and the next sync keeps the old baseline as the undo point`() {
        val core = core(backup(manga(M, chapter("/c1"))))
        core.db.use {
            val first = core.run()
            assertEquals(Path.of(first.export!!).name, restoredFrom(decodeBackup(Path.of(first.export!!).readBytes())))
            core.run()
            assertTrue(core.state.resolve("pre-sync.tachibk").exists())
        }
    }

    @Test fun `an import adds what Mihon's restore adds and keeps the rest`() {
        val core = core(EMPTY)
        core.db.use {
            val first = backup(
                manga(
                    M, chapter("/c1", read = true, page = 4), chapter("/c2"), categories = listOf("A"), notes = "mine",
                    tracks = listOf(track(read = 3F), track(tracker = 11, read = 2F, remoteId = 5), track(tracker = 6)),
                ),
                categories = listOf("A"),
            ).apply { backupSources = listOf(BackupSource("MangaDex", SOURCE)) }
            val file = work.resolve("first.tachibk").also { it.writeBytes(encodeBackup(first)) }
            assertEquals("1", core.call("backup.import", buildJsonObject { put("file", file.toString()) }).getValue("manga").jsonPrimitive.content)

            val second = backup(manga(M, chapter("/c1", page = 2), chapter("/c2", bookmark = true, page = 6), notes = "theirs", tracks = listOf(track(read = 1F, remoteId = 9))))
            val secondFile = work.resolve("second.tachibk").also { it.writeBytes(encodeBackup(second)) }
            core.call("backup.import", buildJsonObject { put("file", secondFile.toString()) })

            val m = core.library().manga.getValue(M)
            assertEquals(
                mapOf("/c1" to Triple(true, false, 4L), "/c2" to Triple(false, true, 6L)),
                m.chapters.mapValues { (_, c) -> Triple(c.read, c.bookmark, c.lastPageRead) },
            )
            assertEquals(setOf("A"), m.categories, "an empty category list keeps the manga's")
            assertEquals("mine", m.notes, "a known manga keeps its notes")
            assertEquals(9L to 3F, m.tracks.getValue(ANILIST).let { it.remoteId to it.lastChapterRead }, "the remote id comes in; chapters read never drop")
            val trackers = runBlocking { core.db.run { c -> c.query("SELECT tracker_id FROM manga_track ORDER BY tracker_id") { it.getInt(1) } } }
            assertEquals(listOf(2, 11), trackers, "MangaBaka comes in; a tracker core lacks stays out")
            val names = runBlocking { core.db.run { c -> c.query("SELECT value FROM metas WHERE key = 'miharchy.sourceNames'") { it.getString(1) } } }
            assertEquals(listOf("""{"$SOURCE":"MangaDex"}"""), names)
        }
    }

    @Test fun `a backup by hand leaves out what its parts say, never into the sync folder`() {
        val core = core(backup(manga(M, chapter("/c1", read = true), categories = listOf("A"), tracks = listOf(track(read = 1F)))))
        core.db.use {
            val out = Files.createDirectories(work.resolve("backups"))
            val file = core.call("backup.export", buildJsonObject { put("folder", out.toString()); put("chapters", false); put("tracking", false) })
                .getValue("file").jsonPrimitive.content
            assertTrue(Path.of(file).name.startsWith("miharchy-backup-"))
            val b = decodeBackup(Path.of(file).readBytes())
            assertEquals(listOf(true, true, true), listOf(b.backupManga.single().chapters.isEmpty(), b.backupManga.single().tracking.isEmpty(), b.backupPreferences.isEmpty()))
            assertEquals(listOf("A"), b.backupCategories.map { it.name })

            runBlocking { core.db.run { c -> c.update("INSERT INTO metas (scope, owner, key, value) VALUES ('global', 0, 'miharchy.syncFolder', ?)", out.toString()) } }
            val refused = assertFailsWith<ApiError> { core.call("backup.export", buildJsonObject { put("folder", out.toString()) }) }
            assertEquals("$out is the sync folder. Choose another backup folder in Settings.", refused.message)
        }
    }

    @Test fun `a file that is not a backup is refused with its name, and an empty sync folder syncs nothing in`() {
        val core = core(EMPTY)
        core.db.use {
            val file = work.resolve("notes.txt").also { it.writeBytes("hello".toByteArray()) }
            val e = assertFailsWith<ApiError> { core.call("backup.import", buildJsonObject { put("file", file.toString()) }) }
            assertTrue(e.message!!.startsWith("$file is not a Mihon backup"))
            assertEquals(0, core.call("sync.run", buildJsonObject { put("folder", core.folder.toString()) }).getValue("changes").jsonArray.size)
        }
    }
}
