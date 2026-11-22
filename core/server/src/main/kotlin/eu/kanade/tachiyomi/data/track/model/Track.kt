// Ported from mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026
// app/src/main/java/eu/kanade/tachiyomi/data/database/models/Track.kt and data/track/model/TrackSearch.kt
// Licensed under Apache-2.0. Mihon's Track interface, TrackImpl and the domain Track are one class here.
@file:Suppress("PropertyName")

package eu.kanade.tachiyomi.data.track.model

open class Track {
    var id: Long? = null
    var manga_id: Long = 0
    var tracker_id: Long = 0
    var remote_id: Long = 0
    var library_id: Long? = null
    var title: String = ""
    var last_chapter_read: Double = 0.0
    var total_chapters: Long = 0
    var score: Double = 0.0
    var status: Long = 0
    var started_reading_date: Long = 0
    var finished_reading_date: Long = 0
    var tracking_url: String = ""
    var private: Boolean = false

    fun copyPersonalFrom(other: Track, copyRemotePrivate: Boolean = true) {
        last_chapter_read = other.last_chapter_read
        score = other.score
        status = other.status
        started_reading_date = other.started_reading_date
        finished_reading_date = other.finished_reading_date
        if (copyRemotePrivate) private = other.private
    }

    companion object {
        fun create(serviceId: Long): Track = Track().apply { tracker_id = serviceId }
    }
}

class TrackSearch : Track() {
    var authors: List<String> = emptyList()
    var artists: List<String> = emptyList()
    var cover_url: String = ""
    var summary: String = ""
    var publishing_status: String = ""
    var publishing_type: String = ""
    var start_date: String = ""

    init { score = -1.0 }

    companion object {
        fun create(serviceId: Long): TrackSearch = TrackSearch().apply { tracker_id = serviceId }
    }
}
