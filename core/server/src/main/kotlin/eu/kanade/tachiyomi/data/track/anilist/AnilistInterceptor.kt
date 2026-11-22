// Ported from mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026
// app/src/main/java/eu/kanade/tachiyomi/data/track/anilist/AnilistInterceptor.kt and dto/ALOAuth.kt, dto/ALUser.kt
// Licensed under Apache-2.0. Changes: the User-Agent names Miharchy; kotlin.time instead of Clock.

package eu.kanade.tachiyomi.data.track.anilist

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException

@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class ALOAuth(
    @SerialName("access_token")
    val accessToken: String,
    @EncodeDefault
    val expires: Long = System.currentTimeMillis() + 365L * 24 * 3600 * 1000,
) {
    fun isExpired() = System.currentTimeMillis() + 60_000 > expires
}

data class ALUser(
    val id: Int,
    val name: String,
    val scoreFormat: String,
)

class AnilistInterceptor(val anilist: Anilist, private var token: String?) : Interceptor {

    /**
     * OAuth object used for authenticated requests.
     */
    private var oauth: ALOAuth? = null

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()

        if (token.isNullOrEmpty()) {
            throw IOException("Not authenticated with AniList")
        }
        if (oauth == null) {
            oauth = anilist.loadOAuth() ?: throw IOException("No authentication token")
        }
        if (oauth!!.isExpired()) {
            anilist.logout()
            throw IOException("Token expired. Reconnect AniList in Settings.")
        }

        // Add the authorization header to the original request.
        val authRequest = originalRequest.newBuilder()
            .addHeader("Authorization", "Bearer ${oauth!!.accessToken}")
            .header("User-Agent", "Miharchy")
            .build()

        return chain.proceed(authRequest)
    }

    /**
     * Called when the user authenticates with Anilist for the first time. Sets the refresh token
     * and the oauth object.
     */
    fun setAuth(oauth: ALOAuth?) {
        token = oauth?.accessToken
        this.oauth = oauth
        anilist.saveOAuth(oauth)
    }
}
