// Ported from mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026
// app/src/main/java/eu/kanade/tachiyomi/data/track/mangaupdates/MangaUpdatesInterceptor.kt
// Licensed under Apache-2.0. Changes: the User-Agent names Miharchy.

package eu.kanade.tachiyomi.data.track.mangaupdates

import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException

class MangaUpdatesInterceptor(
    mangaUpdates: MangaUpdates,
) : Interceptor {

    @Volatile
    private var token: String? = mangaUpdates.restoreSession()

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()

        val token = token ?: throw IOException("Not authenticated with MangaUpdates")

        // Add the authorization header to the original request.
        val authRequest = originalRequest.newBuilder()
            .addHeader("Authorization", "Bearer $token")
            .header("User-Agent", "Miharchy")
            .build()

        return chain.proceed(authRequest)
    }

    fun newAuth(token: String?) {
        this.token = token
    }
}
