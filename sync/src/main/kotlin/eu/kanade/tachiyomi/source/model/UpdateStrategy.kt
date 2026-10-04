// Copied from mihonapp/mihon@7aacaa349019ff42b8b05403d8beebe94c8f6dfc
// source-api/src/main/kotlin/eu/kanade/tachiyomi/source/model/UpdateStrategy.kt
// Licensed under Apache-2.0. Doc comments removed; the entries and their order are unchanged.

package eu.kanade.tachiyomi.source.model

@Suppress("UNUSED")
enum class UpdateStrategy {
    ALWAYS_UPDATE,
    ONLY_FETCH_ONCE,
}
