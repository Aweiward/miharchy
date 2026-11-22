// Ported from mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026
// app/src/main/java/eu/kanade/tachiyomi/data/track/mangabaka/MangaBakaInterceptor.kt and dto/MangaBakaOAuth.kt
// Licensed under Apache-2.0. Changes: epoch seconds from System instead of kotlin.time.Clock; the refresh goes
// out on the tracker's client instead of chain.proceed; a token that cannot be refreshed throws an IOException,
// the only exception an OkHttp interceptor may throw, where Mihon went on with the expired token.

package eu.kanade.tachiyomi.data.track.mangabaka

import eu.kanade.tachiyomi.network.parseAs
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException

@Serializable
data class MangaBakaOAuth(
    @SerialName("access_token")
    val accessToken: String,
    @SerialName("refresh_token")
    val refreshToken: String,
    @SerialName("expires_at")
    val expiresAt: Long,
) {
    fun isExpired(): Boolean = System.currentTimeMillis() / 1000 + 60 > expiresAt
}

class MangaBakaInterceptor(private val mangaBaka: MangaBaka) : Interceptor {

    @Volatile
    private var oauth: MangaBakaOAuth? = mangaBaka.loadOAuth()

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()

        var currentAuth = oauth ?: throw IOException("Not authenticated with MangaBaka")

        // Refresh once for all the requests that found the token expired
        if (currentAuth.isExpired()) {
            currentAuth = synchronized(this) {
                val latest = oauth ?: throw IOException("Not authenticated with MangaBaka")
                if (!latest.isExpired()) return@synchronized latest

                // On the tracker's own client, not chain.proceed, so the request takes the same route as every other call.
                val response = mangaBaka.client.newCall(MangaBakaApi.refreshTokenRequest(latest.refreshToken)).execute()
                if (!response.isSuccessful) {
                    response.close()
                    throw IOException("MangaBaka did not refresh the token (HTTP ${response.code}). Reconnect MangaBaka in Settings.")
                }
                val fresh = try {
                    response.parseAs<MangaBakaOAuth>()
                } catch (_: IllegalArgumentException) {
                    // The parse error quotes the reply, which can be a token.
                    throw IOException("MangaBaka sent an unexpected reply to the token refresh.")
                }
                fresh.also(::setAuth)
            }
        }

        return originalRequest.newBuilder()
            .addHeader("Authorization", "Bearer ${currentAuth.accessToken}")
            .build()
            .let(chain::proceed)
    }

    fun setAuth(oauth: MangaBakaOAuth?) {
        this.oauth = oauth

        mangaBaka.saveOAuth(oauth)
    }
}
