package android.webkit

import eu.kanade.tachiyomi.network.NetworkHelper
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.get

/** Android's cookie store, backed by the cookie jar every extension's client uses. */
open class CookieManager {
    private val jar get() = Injekt.get<NetworkHelper>().cookieJar

    open fun getCookie(url: String): String? {
        val u = url.toHttpUrlOrNull() ?: return null
        return jar.loadForRequest(u).joinToString("; ") { "${it.name}=${it.value}" }.ifEmpty { null }
    }

    open fun setCookie(url: String, value: String) {
        url.toHttpUrlOrNull()?.let { jar.add(it, listOf(value)) }
    }

    open fun setCookie(url: String, value: String, callback: ValueCallback<Boolean>?) {
        setCookie(url, value)
        callback?.onReceiveValue(true)
    }

    open fun setAcceptCookie(accept: Boolean) {}
    open fun acceptCookie(): Boolean = true
    open fun setAcceptThirdPartyCookies(webview: WebView, accept: Boolean) {}
    open fun acceptThirdPartyCookies(webview: WebView): Boolean = true
    open fun hasCookies(): Boolean = true
    open fun flush() {}
    open fun removeAllCookies(callback: ValueCallback<Boolean>?) { callback?.onReceiveValue(false) }
    open fun removeSessionCookies(callback: ValueCallback<Boolean>?) { callback?.onReceiveValue(false) }

    companion object {
        private val instance = CookieManager()
        @JvmStatic fun getInstance(): CookieManager = instance
    }
}
