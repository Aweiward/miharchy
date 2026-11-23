// Ported from mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026
// app/src/main/java/eu/kanade/tachiyomi/data/track/myanimelist/MyAnimeListInterceptor.kt
// Licensed under Apache-2.0. Changes: trackJson instead of an injected Json; the token refresh goes through the
// tracker's base client (where Mihon calls chain.proceed), so it takes the same route as every other request.

package eu.kanade.tachiyomi.data.track.myanimelist

import eu.kanade.tachiyomi.network.parseAs
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import java.io.IOException

class MyAnimeListInterceptor(
    private val myanimelist: MyAnimeList,
    private val client: OkHttpClient,
) : Interceptor {

    private var oauth: MALOAuth? = myanimelist.loadOAuth()
    private val tokenExpired get() = myanimelist.getIfAuthExpired()

    override fun intercept(chain: Interceptor.Chain): Response {
        if (tokenExpired) {
            throw MALTokenExpired()
        }
        val originalRequest = chain.request()

        if (oauth?.isExpired() == true) {
            refreshToken()
        }

        if (oauth == null) {
            throw IOException("MAL: User is not authenticated")
        }

        // Add the authorization header to the original request
        val authRequest = originalRequest.newBuilder()
            .addHeader("Authorization", "Bearer ${oauth!!.accessToken}")
            // Mihon keeps its custom User-Agent off for MAL, which blocks it.
            .build()

        return chain.proceed(authRequest)
    }

    /**
     * Called when the user authenticates with MyAnimeList for the first time. Sets the refresh token
     * and the oauth object.
     */
    fun setAuth(oauth: MALOAuth?) {
        this.oauth = oauth
        myanimelist.saveOAuth(oauth)
    }

    private fun refreshToken(): MALOAuth = synchronized(this) {
        if (tokenExpired) throw MALTokenExpired()
        oauth?.takeUnless { it.isExpired() }?.let { return@synchronized it }

        val response = try {
            client.newCall(MyAnimeListApi.refreshTokenRequest(oauth!!)).execute()
        } catch (_: Throwable) {
            throw MALTokenRefreshFailed()
        }

        if (response.code == 401) {
            response.close()
            myanimelist.setAuthExpired()
            throw MALTokenExpired()
        }

        return runCatching {
            if (response.isSuccessful) {
                response.parseAs<MALOAuth>()
            } else {
                response.close()
                null
            }
        }
            .getOrNull()
            ?.also { setAuth(it) }
            ?: throw MALTokenRefreshFailed()
    }
}

class MALTitleNotApproved : IOException("MAL: This title can't be added because it is waiting for approval.")
class MALTokenRefreshFailed : IOException("MAL: Failed to refresh account token")
class MALTokenExpired : IOException("MAL: Login has expired")
