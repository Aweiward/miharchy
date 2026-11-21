package org.chromium.support_lib_glue

import android.webkit.WebView
import java.lang.reflect.InvocationHandler

/** Chromium's support-library glue, which AndroidX WebKit looks up by reflection. Handles document-start scripts and web message listeners. */
object SupportLibReflectionUtil {
    private val FEATURES = arrayOf("DOCUMENT_START_SCRIPT:1", "WEB_MESSAGE_LISTENER", "WEB_MESSAGE_ARRAY_BUFFER")

    @JvmStatic
    fun createWebViewProviderFactory(): InvocationHandler = InvocationHandler { proxy, m, args ->
        when (m.name) {
            "getSupportedFeatures" -> FEATURES.copyOf()
            "createWebView" -> provider(args!![0] as WebView)
            else -> common(proxy, m.name, args)
        }
    }

    private fun provider(view: WebView) = InvocationHandler { proxy, m, args ->
        when (m.name) {
            "addDocumentStartJavaScript" -> {
                @Suppress("UNCHECKED_CAST")
                view.addDocumentStartScript(args!![0] as String, (args[1] as Array<String>).toList())
                // The desktop view can't remove scripts, so they stay for the view's life.
                InvocationHandler { p, mm, a -> if (mm.name == "remove") null else common(p, mm.name, a) }
            }
            "addWebMessageListener" -> {
                @Suppress("UNCHECKED_CAST")
                view.addMessageListener(args!![0] as String, (args[1] as Array<String>).toList(), args[2] as InvocationHandler)
                null
            }
            "removeWebMessageListener" -> null.also { view.listeners.remove(args!![0] as String) }
            "setAudioMuted" -> null
            else -> common(proxy, m.name, args)
        }
    }

    private fun common(proxy: Any?, name: String, args: Array<out Any?>?): Any? = when (name) {
        "equals" -> proxy === args?.getOrNull(0)
        "hashCode" -> System.identityHashCode(proxy)
        "toString" -> "YomiWebViewGlue"
        else -> throw UnsupportedOperationException("WebView support library: $name")
    }
}
