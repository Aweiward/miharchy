package miharchy.core

import eu.kanade.tachiyomi.source.model.FilterList
import eu.kanade.tachiyomi.source.Source
import eu.kanade.tachiyomi.source.model.MangasPage
import eu.kanade.tachiyomi.source.model.Page
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.SManga
import eu.kanade.tachiyomi.source.model.SMangaUpdate
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Two sources a test jar carries. They load from the test class path, so these tests prove the checks, not where classes come from. */
abstract class Fixture(override val id: Long) : Source {
    override val name = "Fixture $id"
    override val supportsLatest = false
    override suspend fun getPopularManga(page: Int) = MangasPage(emptyList(), false)
    override suspend fun getLatestUpdates(page: Int) = MangasPage(emptyList(), false)
    override suspend fun getSearchManga(page: Int, query: String, filters: FilterList) = MangasPage(emptyList(), false)
    override suspend fun getMangaUpdate(manga: SManga, chapters: List<SChapter>, needsDetails: Boolean, needsChapters: Boolean): SMangaUpdate = error("unused")
    override suspend fun getPageList(chapter: SChapter): List<Page> = emptyList()
}
class FixtureA : Fixture(4242)
class FixtureB : Fixture(4343)

class ExtensionsTest {
    private val work = Files.createTempDirectory("ext")
    private val pkg = "eu.kanade.tachiyomi.extension.en.fixture"
    private val repo = TestRepo(work, pkg)
    private val base = repo.base
    private fun keystore(name: String) = repo.keystore(name)
    private fun jar(classes: List<Class<*>>, ks: Path?) = repo.jar(classes, ks)
    private fun publish(key: String, code: Int, jar: ByteArray?) = repo.publish(key, code, jar)

    private fun extensions(db: Database) = Extensions(db, TestHost.host, work.resolve("extensions"))
    private suspend fun Extensions.call(route: String, body: JsonObject = JsonObject(emptyMap())) = routes.call(route, body)
    private suspend fun Extensions.expect(kind: Kind, route: String, body: JsonObject) = routes.expect(kind, route, body)
    private suspend fun loaded(id: Long) = runCatching { TestHost.host.handle(buildJsonObject { put("op", "popular"); put("source", id.toString()) }) }.isSuccess
    private fun url(u: String) = buildJsonObject { put("url", u) }
    private val install = buildJsonObject { put("pkgName", pkg) }

    @Test
    fun anyRepoAddressFormAddsAndRemovesTheSameRepo() = runBlocking {
        val (_, key) = keystore("a")
        publish(key, 1, jar(listOf(FixtureA::class.java), null))
        Database(work.resolve("core.db")).use { db ->
            val ext = extensions(db)
            val repo = ext.call("extensionRepo.add", url("$base/index.min.json"))["repo"]!!.jsonObject
            assertEquals("$base/index.json", repo["indexUrl"]!!.jsonPrimitive.content)
            assertEquals("Fixture repo", repo["name"]!!.jsonPrimitive.content)
            ext.call("extensionRepo.add", url("$base/"))
            assertEquals(1, ext.call("extensionRepo.list")["repos"]!!.jsonArray.size)
            ext.call("extensionRepo.remove", url(repo["indexUrl"]!!.jsonPrimitive.content))
            assertEquals(0, ext.call("extensionRepo.list")["repos"]!!.jsonArray.size)
            ext.expect(Kind.invalid, "extensionRepo.add", url("ftp://example.org"))
            ext.expect(Kind.invalid, "extensionRepo.add", url("${base.removeSuffix("/repo")}/nothing"))
        }
    }

    @Test
    fun aRepoWithoutJarsOrWhoseKeyChangedIsRefused() = runBlocking {
        val (_, key) = keystore("b")
        Database(work.resolve("core.db")).use { db ->
            val ext = extensions(db)
            publish(key, 1, null)
            ext.expect(Kind.invalid, "extensionRepo.add", url(base))
            publish(key, 1, jar(listOf(FixtureA::class.java), null))
            ext.call("extensionRepo.add", url(base))
            publish("0".repeat(64), 1, jar(listOf(FixtureA::class.java), null))
            ext.expect(Kind.invalid, "extensionRepo.add", url(base))
            assertEquals(1, ext.call("extension.list")["errors"]!!.jsonArray.size)
            // cached answers from the index already held, with no fetch, so the broken repo shows no error (#394).
            val cached = ext.call("extension.list", buildJsonObject { put("cached", true) })
            assertEquals(0, cached["errors"]!!.jsonArray.size)
            assertEquals(1, cached["extensions"]!!.jsonArray.size)
        }
    }

    // One ordered story, because a JVM has one host and its source ids are shared.
    @Test
    fun aJarLoadsOnlyWithItsPinnedKeyAndUpdatesAndRemovesCleanly() = runBlocking {
        val (good, key) = keystore("good")
        val (other, _) = keystore("other")
        val dir = work.resolve("extensions")
        Database(work.resolve("core.db")).use { db ->
            val ext = extensions(db)
            publish(key, 1, jar(listOf(FixtureA::class.java, FixtureB::class.java), other))
            ext.call("extensionRepo.add", url(base))
            ext.expect(Kind.invalid, "extension.install", install)
            publish(key, 1, jar(listOf(FixtureA::class.java, FixtureB::class.java), null))
            ext.expect(Kind.invalid, "extension.install", install)
            assertFalse(loaded(4242))
            assertEquals(listOf(), Files.list(dir).use { s -> s.map { it.fileName.toString() }.toList() })

            publish(key, 1, jar(listOf(FixtureA::class.java, FixtureB::class.java), good))
            val installed = ext.call("extension.install", install)["extension"]!!.jsonObject
            assertEquals("true", installed["isInstalled"].toString())
            assertEquals("\"NSFW\"", installed["contentWarning"].toString())
            assertEquals("\"Fixture\"", installed["name"].toString())
            assertEquals(listOf("4242", "4343"), installed["sources"]!!.jsonArray.map { it.jsonObject["id"]!!.jsonPrimitive.content })
            assertTrue(loaded(4242) && loaded(4343))

            publish(key, 2, jar(listOf(FixtureA::class.java), good))
            val row = ext.call("extension.list")["extensions"]!!.jsonArray.single().jsonObject
            assertEquals("true", row["hasUpdate"].toString())
            ext.call("extension.updateAll", buildJsonObject {})
            assertTrue(loaded(4242))
            assertFalse(loaded(4343), "the update dropped this source")
            assertEquals(setOf("$pkg-2.jar", "$pkg.json"), Files.list(dir).use { s -> s.map { it.fileName.toString() }.toList() }.toSet())
        }
        // A restart loads what is installed, with the key pinned at install.
        Database(work.resolve("core.db")).use { db ->
            TestHost.host.handle(buildJsonObject { put("op", "unload"); put("sources", kotlinx.serialization.json.JsonArray(listOf(kotlinx.serialization.json.JsonPrimitive("4242")))) })
            val ext = extensions(db)
            ext.start()
            assertTrue(loaded(4242))
            ext.call("extension.list")
            // With its repo gone, no repo offers it: the reply is null, and the view drops the row.
            ext.call("extensionRepo.remove", url(base))
            assertEquals("true", ext.call("extension.list")["extensions"]!!.jsonArray.single().jsonObject["isObsolete"].toString())
            assertEquals(kotlinx.serialization.json.JsonNull, ext.call("extension.remove", install)["extension"])
            assertFalse(loaded(4242))
            assertEquals(listOf(), Files.list(dir).use { s -> s.map { it.fileName.toString() }.toList() })
        }
        repo.close()
    }
}
