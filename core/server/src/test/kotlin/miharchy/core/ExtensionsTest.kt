package miharchy.core

import com.sun.net.httpserver.HttpServer
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
import yomi.host.Host
import yomi.host.startHost
import java.io.ByteArrayOutputStream
import java.net.InetSocketAddress
import java.nio.file.Files
import java.nio.file.Path
import java.security.KeyStore
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.test.fail

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

/** One host for the whole test JVM, as in core. */
object TestHost {
    val host: Host by lazy { startHost(Files.createTempDirectory("test-host").toFile()) }
}

class ExtensionsTest {
    private val work = Files.createTempDirectory("ext")
    private val files = ConcurrentHashMap<String, ByteArray>()
    private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
        createContext("/") { ex ->
            val body = files[ex.requestURI.path]
            ex.sendResponseHeaders(if (body == null) 404 else 200, if (body == null) -1 else body.size.toLong())
            body?.let { ex.responseBody.write(it) }
            ex.close()
        }
        start()
    }
    private val base = "http://127.0.0.1:${server.address.port}/repo"
    private val pkg = "eu.kanade.tachiyomi.extension.en.fixture"

    private fun keystore(name: String): Pair<Path, String> {
        val ks = work.resolve("$name.p12")
        tool("keytool", "-genkeypair", "-keystore", ks.toString(), "-storetype", "PKCS12", "-storepass", "secret", "-alias", "k",
            "-keyalg", "RSA", "-keysize", "2048", "-dname", "CN=$name", "-validity", "30")
        val cert = KeyStore.getInstance("PKCS12").apply { Files.newInputStream(ks).use { load(it, "secret".toCharArray()) } }.getCertificate("k")
        return ks to MessageDigest.getInstance("SHA-256").digest(cert.encoded).joinToString("") { "%02x".format(it) }
    }

    private fun tool(name: String, vararg args: String) {
        val p = ProcessBuilder(Path.of(System.getProperty("java.home"), "bin", name).toString(), *args).redirectErrorStream(true).start()
        val out = p.inputStream.readAllBytes().toString(Charsets.UTF_8)
        check(p.waitFor() == 0) { "$name failed: $out" }
    }

    /** A jar like an extension's: AndroidManifest.xml naming [classes], signed with [ks] unless null. */
    private fun jar(classes: List<Class<*>>, ks: Path?): ByteArray {
        val bytes = ByteArrayOutputStream().also { out ->
            ZipOutputStream(out).use { zip ->
                zip.putNextEntry(ZipEntry("AndroidManifest.xml"))
                zip.write("""<manifest package="$pkg"><meta-data android:name="tachiyomi.extension.class" android:value="${classes.joinToString(";") { it.name }}"/></manifest>""".toByteArray())
                for (c in classes) {
                    zip.putNextEntry(ZipEntry(c.name.replace('.', '/') + ".class"))
                    zip.write(c.getResourceAsStream(c.simpleName + ".class")!!.readAllBytes())
                }
            }
        }.toByteArray()
        if (ks == null) return bytes
        val file = Files.createTempFile(work, "x", ".jar").also { Files.write(it, bytes) }
        tool("jarsigner", "-keystore", ks.toString(), "-storepass", "secret", file.toString(), "k")
        return Files.readAllBytes(file)
    }

    private fun publish(key: String, code: Int, jar: ByteArray?) {
        files["/repo/index.json"] = """{"name":"Fixture repo","signingKey":"$key","extensionList":{"extensions":[
            {"name":"Tachiyomi: Fixture","packageName":"$pkg","versionCode":"$code","versionName":"1.6.$code","contentWarning":"CONTENT_WARNING_NSFW",
             "resources":{${if (jar != null) "\"jarUrl\":\"$base/fixture-$code.jar\"," else ""}"apkUrl":"$base/x.apk"}}]}}""".toByteArray()
        if (jar != null) files["/repo/fixture-$code.jar"] = jar
    }

    private fun extensions(db: Database) = Extensions(db, TestHost.host, work.resolve("extensions"))
    private suspend fun Extensions.call(route: String, body: JsonObject = JsonObject(emptyMap())) = routes.getValue(route)(body).jsonObject
    private suspend fun Extensions.expect(kind: Kind, route: String, body: JsonObject) {
        try { call(route, body); fail("$route should fail with $kind") } catch (e: ApiError) { assertEquals(kind, e.kind, e.message) }
    }
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
            ext.expect(Kind.invalid, "extensionRepo.add", url("http://127.0.0.1:${server.address.port}/nothing"))
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
            val removed = ext.call("extension.remove", install)["extension"]!!.jsonObject
            assertEquals("false", removed["isInstalled"].toString())
            assertFalse(loaded(4242))
            assertEquals(listOf(), Files.list(dir).use { s -> s.map { it.fileName.toString() }.toList() })
        }
        server.stop(0)
    }
}
