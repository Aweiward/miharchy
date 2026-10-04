// Copied from mihonapp/mihon@7aacaa349019ff42b8b05403d8beebe94c8f6dfc
// app/src/main/java/eu/kanade/tachiyomi/data/backup/models/BackupPreference.kt
// Licensed under Apache-2.0. Mappers to Mihon domain types are removed; the schema is unchanged.

package eu.kanade.tachiyomi.data.backup.models

import kotlinx.serialization.Serializable
import kotlinx.serialization.protobuf.ProtoNumber

@Serializable
data class BackupPreference(
    @ProtoNumber(1) val key: String,
    @ProtoNumber(2) val value: PreferenceValue,
)

@Serializable
data class BackupSourcePreferences(
    @ProtoNumber(1) val sourceKey: String,
    @ProtoNumber(2) val prefs: List<BackupPreference>,
)

@Serializable
sealed class PreferenceValue

@Serializable
data class IntPreferenceValue(val value: Int) : PreferenceValue()

@Serializable
data class LongPreferenceValue(val value: Long) : PreferenceValue()

@Serializable
data class FloatPreferenceValue(val value: Float) : PreferenceValue()

@Serializable
data class StringPreferenceValue(val value: String) : PreferenceValue()

@Serializable
data class BooleanPreferenceValue(val value: Boolean) : PreferenceValue()

@Serializable
data class StringSetPreferenceValue(val value: Set<String>) : PreferenceValue()
