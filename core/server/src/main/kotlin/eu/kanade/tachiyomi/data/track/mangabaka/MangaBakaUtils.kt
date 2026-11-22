// Ported from mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026
// app/src/main/java/eu/kanade/tachiyomi/data/track/mangabaka/MangaBakaUtils.kt
// Licensed under Apache-2.0. Changes: Track is core's one Track class; an unknown status is a plain Exception.

package eu.kanade.tachiyomi.data.track.mangabaka

import eu.kanade.tachiyomi.data.track.model.Track

internal fun Track.toApiStatus() = when (status) {
    MangaBaka.CONSIDERING -> "considering"
    MangaBaka.COMPLETED -> "completed"
    MangaBaka.DROPPED -> "dropped"
    MangaBaka.PAUSED -> "paused"
    MangaBaka.PLAN_TO_READ -> "plan_to_read"
    MangaBaka.READING -> "reading"
    MangaBaka.REREADING -> "rereading"
    else -> throw Exception("Unknown status: $status")
}
