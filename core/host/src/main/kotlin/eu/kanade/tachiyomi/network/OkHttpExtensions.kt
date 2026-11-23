package eu.kanade.tachiyomi.network

import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Response
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    enqueue(
        object : Callback {
            override fun onResponse(call: Call, response: Response) = cont.resume(response)
            override fun onFailure(call: Call, e: IOException) = cont.resumeWithException(e)
        },
    )
    cont.invokeOnCancellation { cancel() }
}

suspend fun Call.awaitSuccess(): Response {
    val response = await()
    if (!response.isSuccessful) {
        response.close()
        throw HttpException(response.code)
    }
    return response
}
