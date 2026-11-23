package miharchy.core

import eu.kanade.tachiyomi.data.backup.models.Backup
import eu.kanade.tachiyomi.data.backup.models.BackupChapter
import eu.kanade.tachiyomi.data.backup.models.BackupManga
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import miharchy.sync.decodeBackup
import miharchy.sync.exportsToPrune
import miharchy.sync.newestPhoneBackup
import java.io.ByteArrayOutputStream
import java.io.PrintStream
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.FileTime
import java.time.Instant
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import kotlin.io.path.exists
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readBytes
import kotlin.io.path.writeBytes
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SettingsTest {
    private val work = Files.createTempDirectory("settings")
    private val zone = ZoneId.of("Europe/Berlin")

    @AfterTest fun clean() {
        work.toFile().deleteRecursively()
    }

    private fun at(text: String): Instant = LocalDateTime.parse(text).atZone(zone).toInstant()
    private fun settings(vararg pairs: Pair<String, Any>) = buildJsonObject {
        put("settings", buildJsonObject {
            pairs.forEach { (k, v) -> when (v) { is Boolean -> put(k, v); is Int -> put(k, v); else -> put(k, v.toString()) } }
        })
    }
    private suspend fun meta(db: Database, key: String): String? =
        db.run { c -> c.query("SELECT value FROM metas WHERE scope = 'global' AND owner = 0 AND key = ?", key) { it.getString(1) }.firstOrNull() }
    private suspend fun setMeta(db: Database, key: String, value: String) = db.run { c ->
        c.update("INSERT INTO metas (scope, owner, key, value) VALUES ('global', 0, ?, ?) ON CONFLICT (scope, owner, key) DO UPDATE SET value = excluded.value", key, value)
    }

    @Test fun `every server row reads its default, and core names the ones it does not act on`() = runBlocking {
        Database(work.resolve("core.db")).use { db ->
            val reply = Settings(db, work.resolve("covers")).routes.call("settings.get")
            val s = reply.getValue("settings").jsonObject
            assertEquals(23, s.size)
            assertEquals(listOf("12", "true", "00:00", "14", ""), listOf("globalUpdateInterval", "excludeUnreadChapters", "backupTime", "backupTTL", "backupPath").map { s.getValue(it).jsonPrimitive.content })
            assertTrue(s.getValue("backupTime").jsonPrimitive.isString)
            assertFalse(s.getValue("backupTTL").jsonPrimitive.isString)
            assertEquals(
                listOf("kcefEnabled", "updateMangas", "downloadsPath", "downloadAsCbz"),
                reply.getValue("unapplied").jsonArray.map { it.jsonPrimitive.content },
            )
        }
    }

    @Test fun `a save stores the strings Updates reads, and any bad key or value stores nothing`() = runBlocking {
        Database(work.resolve("core.db")).use { db ->
            val routes = Settings(db, work.resolve("covers")).routes
            val reply = routes.call("settings.set", settings("excludeCompleted" to false, "globalUpdateInterval" to 24, "backupTime" to "21:30"))
            assertEquals(24, reply.getValue("settings").jsonObject.getValue("globalUpdateInterval").jsonPrimitive.int)
            assertEquals(listOf("false", "24", "21:30"), listOf("excludeCompleted", "globalUpdateInterval", "backupTime").map { meta(db, "miharchy.$it") })

            routes.expect(Kind.invalid, "settings.set", settings("backupTTL" to 30, "globalUpdateInterval" to 3))
            routes.expect(Kind.invalid, "settings.set", settings("backupTTL" to 30, "nope" to true))
            routes.expect(Kind.invalid, "settings.set", settings("excludeCompleted" to "false"))
            routes.expect(Kind.invalid, "settings.set", settings("backupTime" to "25:00"))
            routes.expect(Kind.invalid, "settings.set", settings("flareSolverrUrl" to "localhost:8191"))
            routes.expect(Kind.invalid, "settings.set", settings("downloadsPath" to "relative/folder"))
            assertNull(meta(db, "miharchy.backupTTL"), "a refused save stores none of its keys")

            // meta.set writes anything under these keys; a value no rule takes reads as the default.
            setMeta(db, "miharchy.backupTTL", "13")
            setMeta(db, "miharchy.excludeNotStarted", "yes")
            val s = routes.call("settings.get").getValue("settings").jsonObject
            assertEquals(listOf("14", "true"), listOf(s.getValue("backupTTL"), s.getValue("excludeNotStarted")).map { it.jsonPrimitive.content })
        }
    }

    @Test fun `the backup folder must exist and is never the sync folder`() = runBlocking {
        Database(work.resolve("core.db")).use { db ->
            val routes = Settings(db, work.resolve("covers")).routes
            val folder = Files.createDirectories(work.resolve("phone"))
            routes.expect(Kind.invalid, "settings.set", settings("backupPath" to work.resolve("missing").toString()))
            setMeta(db, Sync.SYNC_FOLDER_KEY, folder.toString())
            routes.expect(Kind.invalid, "settings.set", settings("backupPath" to "$folder/"))
            routes.call("settings.set", settings("backupPath" to ""))
            assertEquals("", meta(db, "miharchy.backupPath"))
        }
    }

    @Test fun `the update filters and schedule follow a settings save`() = runBlocking {
        Database(work.resolve("core.db")).use { db ->
            db.run { c ->
                c.update("INSERT INTO manga (source_id, remote_url, remote_title, user_favorite_at, state_initialized) VALUES (1, '/m', 'M', 1, 1)")
                c.update("INSERT INTO chapter (manga_id, remote_url, remote_name, remote_chapter_number, remote_order, state_date_fetch) VALUES (1, '/c', 'C', 1, 0, 0)")
            }
            val routes = Settings(db, work.resolve("covers")).routes
            Updates(db, { }, tick = 3_600_000).use { u ->
                assertEquals(1, u.routes.call("update.start").getValue("skippedMangasCount").jsonPrimitive.int, "unread chapters skip by default")
                // The manga is not started either.
                routes.call("settings.set", settings("excludeUnreadChapters" to false, "excludeNotStarted" to false))
                kotlinx.coroutines.withTimeout(10_000) { while (u.routes.call("update.status").getValue("isRunning").jsonPrimitive.content == "true") kotlinx.coroutines.delay(10) }
                assertEquals(0, u.routes.call("update.start").getValue("skippedMangasCount").jsonPrimitive.int)
            }
            routes.call("settings.set", settings("globalUpdateInterval" to 0))
            var runs = 0
            Updates(db, { runs++ }, hour = 1, tick = 10).use {
                kotlinx.coroutines.delay(300)
                assertEquals(0, runs, "0 turns the schedule off")
            }
        }
    }

    @Test fun `clearing the cache deletes covers outside the library and keeps the library's and one being written`() = runBlocking {
        Database(work.resolve("core.db")).use { db ->
            db.run { c ->
                c.update("INSERT INTO manga (id, source_id, remote_url, remote_title, user_favorite_at) VALUES (1, 1, '/a', 'A', 1), (2, 1, '/b', 'B', NULL), (3, 1, '/c', 'C', NULL)")
            }
            val covers = Files.createDirectories(work.resolve("covers"))
            covers.resolve("1-abc").writeBytes(ByteArray(300))
            covers.resolve("2-def").writeBytes(ByteArray(200))
            covers.resolve("3-ghi").writeBytes(ByteArray(100))
            covers.resolve("3.part").writeBytes(ByteArray(50))
            val downloads = Files.createDirectories(work.resolve("downloads/S/M"))
            downloads.resolve("c.cbz").writeBytes(ByteArray(1000))
            val sizes = Settings(db, covers).routes.call("storage.get")
            assertEquals(1000, sizes.getValue("downloads").jsonPrimitive.int)
            // The folder the local source reads: its default, then the setting's.
            assertEquals(work.resolve("local").toAbsolutePath().toString(), Settings(db, covers).routes.call("settings.get").getValue("localFolder").jsonPrimitive.content)
            val set = Settings(db, covers).routes.call("settings.set", buildJsonObject { put("settings", buildJsonObject { put("localSourcePath", "/mnt/comics") }) })
            assertEquals("/mnt/comics", set.getValue("localFolder").jsonPrimitive.content)
            assertEquals(300, sizes.getValue("cache").jsonPrimitive.int, "the covers a clear would free")
            assertEquals(300, Settings(db, covers).routes.call("cache.clear").getValue("freed").jsonPrimitive.int)
            assertEquals(0, Settings(db, covers).routes.call("storage.get").getValue("cache").jsonPrimitive.int)
            assertEquals(listOf("1-abc", "3.part"), covers.listDirectoryEntries().map { it.name }.sorted())
            assertEquals(0, Settings(db, work.resolve("none")).routes.call("cache.clear").getValue("freed").jsonPrimitive.int)
        }
    }

    @Test fun `a backup is due at each slot, catches up a missed one, and keeps the next on time`() {
        val midnight = LocalTime.of(0, 0)
        val evening = LocalTime.of(21, 0)
        val since = at("2026-11-20T08:00")
        assertFalse(backupDue(at("2026-11-20T23:59"), null, since, 1, midnight, zone), "the first waits for a slot after the timer started")
        assertTrue(backupDue(at("2026-11-21T00:00"), null, since, 1, midnight, zone))
        assertTrue(backupDue(at("2026-11-23T09:00"), null, since, 1, midnight, zone), "off at every slot: the first start after one catches up")
        assertFalse(backupDue(at("2026-11-21T23:00"), at("2026-11-21T00:00"), since, 1, midnight, zone))
        assertTrue(backupDue(at("2026-11-22T00:01"), at("2026-11-21T00:00"), since, 1, midnight, zone))
        // A run late for 21:00 (core was off) counts for that slot, so the next 21:00 still runs.
        assertTrue(backupDue(at("2026-11-22T21:00"), at("2026-11-22T01:00"), since, 1, evening, zone))
        assertFalse(backupDue(at("2026-11-23T21:00"), at("2026-11-22T21:00"), since, 2, evening, zone))
        assertTrue(backupDue(at("2026-11-24T21:00"), at("2026-11-22T21:00"), since, 2, evening, zone))
        assertFalse(backupDue(at("2026-11-24T21:00"), null, since, 0, evening, zone), "0 is off")
    }

    private class Rig(val db: Database, val backups: Backups, val folder: Path)

    private fun rig(clock: () -> Instant): Rig {
        val db = Database(work.resolve("core.db"))
        runBlocking {
            db.run { c ->
                Sync(db, work.resolve("state"), "", setOf(2)).restore(c, Backup(listOf(BackupManga(1, "/m", "M", chapters = listOf(BackupChapter("/c", "C"))))))
            }
        }
        val sync = Sync(db, work.resolve("state"), "", setOf(2))
        val folder = work.resolve("backups")
        return Rig(db, Backups(db, sync, folder, clock, { zone }, tick = 3_600_000), folder)
    }

    @Test fun `automatic backups run on schedule into the default folder, keep the meta for after a restart, and prune only their own`() = runBlocking {
        var now = at("2026-11-20T08:00")
        val rig = rig { now }
        rig.db.use {
            rig.backups.use { b ->
                b.check()
                assertFalse(rig.folder.exists(), "no slot since the timer started")
                assertEquals(now.toEpochMilli().toString(), meta(rig.db, Backups.SINCE))
            }
            // A restart: the reference time stays, so the slot the machine was off for still counts.
            now = at("2026-11-21T09:00")
            Backups(rig.db, Sync(rig.db, work.resolve("state"), "", setOf(2)), rig.folder, { now }, { zone }, tick = 3_600_000).use { b ->
                Files.createDirectories(rig.folder)
                val old = rig.folder.resolve("miharchy-auto-2026-10-01_00-00-00.tachibk").also { it.writeBytes(ByteArray(1)) }
                val mine = rig.folder.resolve("phone-copy.tachibk").also { it.writeBytes(ByteArray(1)) }
                listOf(old, mine).forEach { Files.setLastModifiedTime(it, FileTime.from(at("2026-10-01T00:00"))) }
                b.check()
                val made = rig.folder.listDirectoryEntries("miharchy-auto-*").map { it.name }
                assertEquals(listOf("miharchy-auto-2026-11-21_08-00-00.tachibk"), made)
                assertEquals(listOf("M"), decodeBackup(rig.folder.resolve(made.single()).readBytes()).backupManga.map { it.title })
                assertTrue(mine.exists(), "only automatic backups are pruned")
                assertEquals(now.toEpochMilli().toString(), meta(rig.db, Backups.LAST))
                b.check()
                assertEquals(1, rig.folder.listDirectoryEntries("miharchy-auto-*").size, "one per slot")
                // Neither the sync's own pruning nor its phone backup pick reads an automatic backup.
                assertEquals(emptyList(), exportsToPrune(made + listOf("miharchy-auto-2026-11-20_08-00-00.tachibk", "miharchy-auto-2026-11-19_08-00-00.tachibk", "miharchy-auto-2026-11-18_08-00-00.tachibk")))
                assertEquals("phone-copy.tachibk", newestPhoneBackup(rig.folder)?.name)
            }
        }
    }

    @Test fun `a refused automatic backup logs once, writes no meta, and runs once the folder is fixed`() = runBlocking {
        val now = at("2026-11-21T09:00")
        val rig = rig { now }
        rig.db.use {
            setMeta(rig.db, Backups.SINCE, at("2026-11-20T08:00").toEpochMilli().toString())
            val target = Files.createDirectories(work.resolve("phone"))
            setMeta(rig.db, "miharchy.backupPath", target.toString())
            setMeta(rig.db, Sync.SYNC_FOLDER_KEY, target.toString())
            setMeta(rig.db, "miharchy.autoBackupIncludeChapters", "false")
            val err = ByteArrayOutputStream()
            val before = System.err
            System.setErr(PrintStream(err, true))
            try {
                rig.backups.use { b ->
                    repeat(3) { b.check() }
                }
            } finally {
                System.setErr(before)
            }
            assertNull(meta(rig.db, Backups.LAST))
            assertEquals(0, target.listDirectoryEntries().size)
            setMeta(rig.db, Sync.SYNC_FOLDER_KEY, work.resolve("elsewhere").toString())
            Backups(rig.db, Sync(rig.db, work.resolve("state"), "", setOf(2)), rig.folder, { now }, { zone }, tick = 3_600_000).use { it.check() }
            val made = target.listDirectoryEntries().single()
            assertTrue(decodeBackup(made.readBytes()).backupManga.single().chapters.isEmpty(), "the include rows choose the parts")
            assertEquals(1, err.toString().lines().count { it.contains("is the sync folder") }, err.toString())
        }
    }

    @Test fun `a backup by hand without a folder uses the backup row's folder and parts`() = runBlocking {
        val rig = rig { Instant.now() }
        rig.db.use {
            rig.backups.close()
            val sync = Sync(rig.db, work.resolve("state"), "", setOf(2))
            setMeta(rig.db, "miharchy.autoBackupIncludeChapters", "false")
            val file = Path.of(sync.routes.call("backup.export").getValue("file").jsonPrimitive.content)
            assertEquals(work.resolve("backups"), file.parent)
            assertTrue(decodeBackup(file.readBytes()).backupManga.single().chapters.isEmpty())
            val withChapters = Path.of(sync.routes.call("backup.export", buildJsonObject { put("chapters", true) }).getValue("file").jsonPrimitive.content)
            assertEquals(1, decodeBackup(withChapters.readBytes()).backupManga.single().chapters.size)
        }
    }
}
