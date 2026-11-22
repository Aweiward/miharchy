// What Mihon's tracker clients take from Mihon's network helpers (core/common .../network/Requests.kt and
// OkHttpExtensions.kt at mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026), beside the host's GET and POST.
// Licensed under Apache-2.0. parseAs reads with one lenient Json instead of a context receiver.

package eu.kanade.tachiyomi.network

import kotlinx.serialization.json.Json
import okhttp3.CacheControl
import okhttp3.Headers
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.Response

val jsonMime: MediaType = "application/json; charset=utf-8".toMediaType()

val trackJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
}

inline fun <reified T> Response.parseAs(): T = use { trackJson.decodeFromString<T>(it.body.string()) }

private val NO_HEADERS = Headers.Builder().build()
private val NO_CACHE = CacheControl.Builder().noStore().build()
private val EMPTY_BODY: RequestBody = okhttp3.FormBody.Builder().build()

fun PUT(url: String, headers: Headers = NO_HEADERS, body: RequestBody = EMPTY_BODY, cache: CacheControl = NO_CACHE): Request =
    Request.Builder().url(url).put(body).headers(headers).cacheControl(cache).build()

fun PATCH(url: String, headers: Headers = NO_HEADERS, body: RequestBody = EMPTY_BODY, cache: CacheControl = NO_CACHE): Request =
    Request.Builder().url(url).patch(body).headers(headers).cacheControl(cache).build()

fun DELETE(url: String, headers: Headers = NO_HEADERS, body: RequestBody = EMPTY_BODY, cache: CacheControl = NO_CACHE): Request =
    Request.Builder().url(url).delete(body).headers(headers).cacheControl(cache).build()
