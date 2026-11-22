// Ported from mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026
// app/src/main/java/eu/kanade/tachiyomi/data/track/shikimori/ShikimoriInterceptor.kt and dto/SMOAuth.kt, dto/SMUser.kt,
// dto/SMLibraryIdResponse.kt
// Licensed under Apache-2.0. Changes: the User-Agent names Miharchy; java.time instead of kotlin.time; the refresh
// goes through the tracker's own client, so its other interceptors apply; a failed refresh is an IOException
// (the only kind an interceptor may throw) with a fixed message, never the reply, which can hold a token.

package eu.kanade.tachiyomi.data.track.shikimori

import eu.kanade.tachiyomi.network.parseAs
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException

@Serializable
data class SMOAuth(
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

data class SMUser(
    val id: String,
    val nickname: String,
)

@Serializable
data class SMLibraryIdResponse(
    val id: Long,
)

class ShikimoriInterceptor(private val shikimori: Shikimori) : Interceptor {

    /**
     * OAuth object used for authenticated requests.
     */
    @Volatile
    private var oauth: SMOAuth? = null

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()

        var currAuth = oauth ?: shikimori.loadOAuth() ?: throw IOException("Not authenticated with Shikimori")

        // Refresh access token if expired, once for all the requests that found it expired.
        if (currAuth.isExpired()) {
            currAuth = synchronized(this) {
                val latest = oauth ?: shikimori.loadOAuth() ?: throw IOException("Not authenticated with Shikimori")
                if (!latest.isExpired()) return@synchronized latest

                val refreshToken = latest.refreshToken ?: throw IOException("Shikimori token expired. Log in again.")
                val response = shikimori.client.newCall(ShikimoriApi.refreshTokenRequest(refreshToken)).execute()
                if (!response.isSuccessful) {
                    response.close()
                    throw IOException("Shikimori refused to refresh the token (HTTP ${response.code}). Log in again.")
                }
                val fresh = try {
                    response.parseAs<SMOAuth>()
                } catch (_: Exception) {
                    throw IOException("Shikimori sent an unexpected token reply.")
                }
                fresh.also(::newAuth)
            }
        }
        // Add the authorization header to the original request.
        val authRequest = originalRequest.newBuilder()
            .addHeader("Authorization", "Bearer ${currAuth.accessToken}")
            .header("User-Agent", "Miharchy")
            .build()

        return chain.proceed(authRequest)
    }

    fun newAuth(oauth: SMOAuth?) {
        this.oauth = oauth
        shikimori.saveOAuth(oauth)
    }
}
