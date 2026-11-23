// Ported from mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026
// app/src/main/java/eu/kanade/tachiyomi/data/track/kitsu/KitsuInterceptor.kt and dto/KitsuOAuth.kt, dto/KitsuUser.kt
// Licensed under Apache-2.0. Changes: the User-Agent names Miharchy; java.time instead of kotlin.time; the refresh
// goes through the tracker's own client, so its other interceptors apply; a failed refresh is an IOException
// (the only kind an interceptor may throw) with a fixed message, never the reply, which can hold a token.

package eu.kanade.tachiyomi.data.track.kitsu

import eu.kanade.tachiyomi.network.parseAs
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException

@Serializable
data class KitsuOAuth(
    @SerialName("access_token")
    val accessToken: String,
    @SerialName("created_at")
    val createdAt: Long,
    @SerialName("expires_in")
    val expiresIn: Long,
    @SerialName("refresh_token")
    val refreshToken: String?,
) {
    fun isExpired() = System.currentTimeMillis() / 1000 + 3600 > (createdAt + expiresIn)
}

data class KitsuUser(
    val id: String,
    val name: String,
    val ratingSystem: String,
)

class KitsuInterceptor(private val kitsu: Kitsu) : Interceptor {

    /**
     * OAuth object used for authenticated requests.
     */
    @Volatile
    private var oauth: KitsuOAuth? = null

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()

        var currAuth = oauth ?: kitsu.loadOAuth() ?: throw IOException("Not authenticated with Kitsu")

        // Refresh access token if expired, once for all the requests that found it expired.
        if (currAuth.isExpired()) {
            currAuth = synchronized(this) {
                val latest = oauth ?: kitsu.loadOAuth() ?: throw IOException("Not authenticated with Kitsu")
                if (!latest.isExpired()) return@synchronized latest

                val refreshToken = latest.refreshToken ?: throw IOException("Kitsu token expired. Log in again.")
                val response = kitsu.client.newCall(KitsuApi.refreshTokenRequest(refreshToken)).execute()
                if (!response.isSuccessful) {
                    response.close()
                    throw IOException("Kitsu refused to refresh the token (HTTP ${response.code}). Log in again.")
                }
                val fresh = try {
                    response.parseAs<KitsuOAuth>()
                } catch (_: Exception) {
                    throw IOException("Kitsu sent an unexpected token reply.")
                }
                fresh.also(::newAuth)
            }
        }

        // Add the authorization header to the original request.
        val authRequest = originalRequest.newBuilder()
            .addHeader("Authorization", "Bearer ${currAuth.accessToken}")
            .header("User-Agent", "Miharchy")
            .header("Accept", "application/vnd.api+json")
            .header("Content-Type", "application/vnd.api+json")
            .build()

        return chain.proceed(authRequest)
    }

    fun newAuth(oauth: KitsuOAuth?) {
        this.oauth = oauth
        kitsu.saveOAuth(oauth)
    }
}
