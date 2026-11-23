// Ported from mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026
// app/src/main/java/eu/kanade/tachiyomi/data/track/myanimelist/dto/MALList.kt, MALManga.kt, MALOAuth.kt, MALSearch.kt
// and MALUser.kt. Licensed under Apache-2.0. Changes: java.time instead of kotlin.time's Clock.

package eu.kanade.tachiyomi.data.track.myanimelist

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Instant

@Serializable
data class MALListItem(
    @SerialName("num_chapters")
    val numChapters: Long,
    @SerialName("my_list_status")
    val myListStatus: MALListItemStatus?,
)

@Serializable
data class MALListItemStatus(
    @SerialName("is_rereading")
    val isRereading: Boolean,
    val status: String,
    @SerialName("num_chapters_read")
    val numChaptersRead: Double,
    val score: Int,
    @SerialName("start_date")
    val startDate: String?,
    @SerialName("finish_date")
    val finishDate: String?,
)

@Serializable
data class MALManga(
    val id: Long,
    val title: String,
    val synopsis: String = "",
    @SerialName("num_chapters")
    val numChapters: Long,
    val mean: Double = -1.0,
    @SerialName("main_picture")
    val covers: MALMangaCovers?,
    val status: String,
    @SerialName("media_type")
    val mediaType: String,
    @SerialName("start_date")
    val startDate: String?,
    val authors: List<MALAuthorNode> = emptyList(),
)

@Serializable
data class MALAuthorNode(
    val node: MALAuthor,
    val role: String,
)

@Serializable
data class MALAuthor(
    val id: Int,
    @SerialName("first_name")
    val firstName: String,
    @SerialName("last_name")
    val lastName: String,
) {
    fun getFullName(): String? = "$firstName $lastName".trim().ifBlank { null }
}

@Serializable
data class MALMangaCovers(
    val large: String = "",
)

@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class MALOAuth(
    @SerialName("refresh_token")
    val refreshToken: String,
    @SerialName("access_token")
    val accessToken: String,
    @SerialName("expires_in")
    val expiresIn: Long,
    @SerialName("created_at")
    @EncodeDefault
    val createdAt: Long = Instant.now().epochSecond,
) {
    // Assumes expired a minute earlier
    fun isExpired() = Instant.now().epochSecond + 60 > createdAt + expiresIn
}

@Serializable
data class MALSearchResult(
    val data: List<MALSearchResultNode>,
    val paging: MALSearchPaging,
)

@Serializable
data class MALSearchResultNode(
    val node: MALManga,
)

@Serializable
data class MALSearchPaging(
    val next: String?,
)

@Serializable
data class MALUser(
    val name: String,
)
