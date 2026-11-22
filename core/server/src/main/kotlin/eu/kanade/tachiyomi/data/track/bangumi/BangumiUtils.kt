// Ported from mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026
// app/src/main/java/eu/kanade/tachiyomi/data/track/bangumi/BangumiUtils.kt
// Licensed under Apache-2.0. Changes: Track is core's one Track class.

package eu.kanade.tachiyomi.data.track.bangumi

import eu.kanade.tachiyomi.data.track.model.Track

internal fun Track.toApiStatus() = when (status) {
    Bangumi.PLAN_TO_READ -> 1
    Bangumi.COMPLETED -> 2
    Bangumi.READING -> 3
    Bangumi.ON_HOLD -> 4
    Bangumi.DROPPED -> 5
    else -> throw Exception("Unknown status: $status")
}
