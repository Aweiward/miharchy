package eu.kanade.tachiyomi.source.online

import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.network.NetworkHelper
import eu.kanade.tachiyomi.source.CatalogueSource
import eu.kanade.tachiyomi.source.model.FilterList
import eu.kanade.tachiyomi.source.model.Page
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.SManga
import okhttp3.Headers
import okhttp3.OkHttpClient
import okhttp3.Request
import uy.kohesive.injekt.injectLazy
import java.net.URI
import java.security.MessageDigest

abstract class HttpSource : CatalogueSource {
    protected val network: NetworkHelper by injectLazy()

    abstract val baseUrl: String
    open val homeUrl: String get() = baseUrl
    open val versionId: Int = 1

    // Same id scheme as Mihon, so ids match the repo index and other apps' backups.
    override val id: Long by lazy {
        val key = "${name.lowercase()}/$lang/$versionId"
        val bytes = MessageDigest.getInstance("MD5").digest(key.toByteArray())
        (0..7).map { bytes[it].toLong() and 0xff shl 8 * (7 - it) }.reduce(Long::or) and Long.MAX_VALUE
    }

    val headers: Headers by lazy { headersBuilder().build() }
    open val client: OkHttpClient get() = network.client

    protected open fun headersBuilder(): Headers.Builder = Headers.Builder().add("User-Agent", NetworkHelper.USER_AGENT)

    override fun toString() = "$name (${lang.uppercase()})"

    open suspend fun getImageUrl(page: Page): String =
        page.imageUrl ?: throw UnsupportedOperationException("$name does not resolve image urls")

    protected open fun imageRequest(page: Page): Request = GET(page.imageUrl!!, headers)

    /** The host calls this because imageRequest is protected. */
    internal fun hostImageRequest(page: Page): Request = imageRequest(page)

    fun SChapter.setUrlWithoutDomain(url: String) { this.url = stripDomain(url) }
    fun SManga.setUrlWithoutDomain(url: String) { this.url = stripDomain(url) }

    abstract fun getMangaUrl(manga: SManga): String
    abstract fun getChapterUrl(chapter: SChapter): String

    override val supportsRelatedMangas: Boolean get() = false
    override val disableRelatedMangasBySearch: Boolean get() = false
    override val disableRelatedMangas: Boolean get() = false
    override suspend fun fetchRelatedMangaList(manga: SManga): List<SManga> = emptyList()
    override fun getFilterList() = FilterList()

    private fun stripDomain(orig: String): String = try {
        val uri = URI(orig.replace(" ", "%20"))
        buildString {
            append(uri.path)
            uri.query?.let { append('?').append(it) }
            uri.fragment?.let { append('#').append(it) }
        }
    } catch (e: Exception) {
        orig
    }
}
