// Ported from mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026
// app/src/main/java/eu/kanade/tachiyomi/data/track/bangumi/BangumiInterceptor.kt and dto/BGMOAuth.kt, dto/BGMUser.kt
// Licensed under Apache-2.0. Changes: the User-Agent names Miharchy; epoch seconds from System instead of
// kotlin.time.Clock; the refresh goes out on the tracker's client instead of chain.proceed; a token that cannot be
// refreshed throws an IOException, the only exception an OkHttp interceptor may throw, where Mihon went on with the
// expired token.

package eu.kanade.tachiyomi.data.track.bangumi

import eu.kanade.tachiyomi.network.parseAs
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException

@OptIn(ExperimentalSerializationApi::class)
@Serializable
// Incomplete DTO with only our needed attributes
data class BGMOAuth(
    @SerialName("access_token")
    val accessToken: String,
    @SerialName("created_at")
    @EncodeDefault
    val createdAt: Long = System.currentTimeMillis() / 1000,
    @SerialName("expires_in")
    val expiresIn: Long,
    @SerialName("refresh_token")
    val refreshToken: String?,
) {
    // Access token refresh before expired
    fun isExpired() = System.currentTimeMillis() / 1000 + 3600 > (createdAt + expiresIn)
}

@Serializable
// Incomplete DTO with only our needed attributes
data class BGMUser(
    val username: String,
    val nickname: String?,
)

class BangumiInterceptor(private val bangumi: Bangumi) : Interceptor {

    /**
     * OAuth object used for authenticated requests.
     */
    @Volatile
    private var oauth: BGMOAuth? = bangumi.loadOAuth()

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()

        var currAuth: BGMOAuth = oauth ?: throw IOException("Not authenticated with Bangumi")

        if (currAuth.isExpired()) {
            currAuth = refreshToken(chain, currAuth)
        }

        return originalRequest.newBuilder()
            .header("User-Agent", "Miharchy")
            .addHeader("Authorization", "Bearer ${currAuth.accessToken}")
            .build()
            .let(chain::proceed)
    }

    private fun refreshToken(chain: Interceptor.Chain, expired: BGMOAuth): BGMOAuth = synchronized(this) {
        val current = oauth ?: expired
        if (!current.isExpired()) return@synchronized current

        val refresh = current.refreshToken ?: throw IOException("Bangumi token expired. Reconnect Bangumi in Settings.")
        // On the tracker's own client, not chain.proceed, so the request takes the same route as every other call.
        val response = bangumi.client.newCall(BangumiApi.refreshTokenRequest(refresh)).execute()
        if (!response.isSuccessful) {
            response.close()
            throw IOException("Bangumi did not refresh the token (HTTP ${response.code}). Reconnect Bangumi in Settings.")
        }
        val fresh = try {
            response.parseAs<BGMOAuth>()
        } catch (_: IllegalArgumentException) {
            // The parse error quotes the reply, which can be a token.
            throw IOException("Bangumi sent an unexpected reply to the token refresh.")
        }
        fresh.also(::newAuth)
    }

    fun newAuth(oauth: BGMOAuth?) {
        this.oauth = oauth
        bangumi.saveOAuth(oauth)
    }
}
