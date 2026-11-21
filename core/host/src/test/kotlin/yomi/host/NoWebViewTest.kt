package yomi.host

import android.webkit.WebView
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

/** In miharchy-core no app is attached: a WebView fails, and leaves nothing behind that breaks later requests. */
class NoWebViewTest {
    @Test
    fun aWebViewFailsCleanly() {
        assertThrows<WebViewUnavailableException> { WebView(null) }
        // A site that sets a cookie afterwards still works.
        WebViews.cookiesStored("https://example.org/", listOf("a=b"))
    }
}
