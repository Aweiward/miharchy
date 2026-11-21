@file:OptIn(InternalCoroutinesApi::class)

package yomi.host

import kotlinx.coroutines.InternalCoroutinesApi
import kotlinx.coroutines.MainCoroutineDispatcher
import kotlinx.coroutines.internal.MainDispatcherFactory
import android.os.Handler
import android.os.Looper
import kotlin.coroutines.CoroutineContext

/** Dispatchers.Main runs on the main Looper's thread, so coroutines and Handlers share it as on Android. */
object HostMain : MainCoroutineDispatcher() {
    private val handler by lazy { Handler(Looper.getMainLooper()) }
    override val immediate: MainCoroutineDispatcher get() = Immediate
    override fun dispatch(context: CoroutineContext, block: Runnable) {
        handler.post(block)
    }

    /** Runs in place when already on the main thread. */
    private object Immediate : MainCoroutineDispatcher() {
        override val immediate: MainCoroutineDispatcher get() = this
        override fun isDispatchNeeded(context: CoroutineContext) = !Looper.getMainLooper().isCurrentThread
        override fun dispatch(context: CoroutineContext, block: Runnable) = HostMain.dispatch(context, block)
    }
}

class HostMainDispatcherFactory : MainDispatcherFactory {
    override val loadPriority = 0
    override fun createDispatcher(allFactories: List<MainDispatcherFactory>): MainCoroutineDispatcher = HostMain
}
