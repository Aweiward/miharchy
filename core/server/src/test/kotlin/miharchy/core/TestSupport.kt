package miharchy.core

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.util.concurrent.Executors
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
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

/** One host for the whole test JVM, as in core. Each test uses its own source ids. */
object TestHost {
    val host: Host by lazy { startHost(Files.createTempDirectory("test-host").toFile()) }
}

/** A local HTTP server. [handle] answers a path, or null for 404. */
class Site(val handle: (HttpExchange) -> ByteArray?) : AutoCloseable {
    // A thread per request: with the default one thread, a handler a test holds (a cancelled download's
    // late request) would starve every request after it.
    private val pool = Executors.newCachedThreadPool()
    private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
        executor = pool
        createContext("/") { ex ->
            val body = handle(ex)
            ex.sendResponseHeaders(if (body == null) 404 else 200, if (body == null) -1 else body.size.toLong())
            body?.let { ex.responseBody.write(it) }
            ex.close()
        }
        start()
    }
    val url = "http://127.0.0.1:${server.address.port}"
    override fun close() {
        server.stop(0)
        pool.shutdownNow()
    }
}

/** A repo of one extension, [pkg], served from a local [Site], with jars signed at test time. */
class TestRepo(private val work: Path, val pkg: String) : AutoCloseable {
    val files = ConcurrentHashMap<String, ByteArray>()
    private val site = Site { files[it.requestURI.path] }
    val base = "${site.url}/repo"

    fun keystore(name: String): Pair<Path, String> {
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

    /**
     * A jar like an extension's: AndroidManifest.xml naming [classes], signed with [ks] unless null.
     * The classes also sit on the test class path, which loads them first, so tests prove the checks, not where classes come from.
     */
    fun jar(classes: List<Class<*>>, ks: Path?): ByteArray {
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

    fun publish(key: String, code: Int, jar: ByteArray?) {
        files["/repo/index.json"] = """{"name":"Fixture repo","signingKey":"$key","extensionList":{"extensions":[
            {"name":"Tachiyomi: Fixture","packageName":"$pkg","versionCode":"$code","versionName":"1.6.$code","contentWarning":"CONTENT_WARNING_NSFW",
             "resources":{${if (jar != null) "\"jarUrl\":\"$base/fixture-$code.jar\"," else ""}"apkUrl":"$base/x.apk","iconUrl":"https://example.org/icon.png"}}]}}""".toByteArray()
        if (jar != null) files["/repo/fixture-$code.jar"] = jar
    }

    override fun close() = site.close()
}

suspend fun Map<String, Route>.call(route: String, body: JsonObject = JsonObject(emptyMap())) = getValue(route)(body).jsonObject

suspend fun Map<String, Route>.expect(kind: Kind, route: String, body: JsonObject) {
    try {
        call(route, body)
        kotlin.test.fail("$route should fail with $kind")
    } catch (e: ApiError) {
        kotlin.test.assertEquals(kind, e.kind, e.message)
    }
}
