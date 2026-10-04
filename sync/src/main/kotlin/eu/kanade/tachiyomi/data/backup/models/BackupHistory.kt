// Copied from mihonapp/mihon@7aacaa349019ff42b8b05403d8beebe94c8f6dfc
// app/src/main/java/eu/kanade/tachiyomi/data/backup/models/BackupHistory.kt
// Licensed under Apache-2.0. Mappers to Mihon domain types are removed; the schema is unchanged.

package eu.kanade.tachiyomi.data.backup.models

import kotlinx.serialization.Serializable
import kotlinx.serialization.protobuf.ProtoNumber

@Serializable
data class BackupHistory(
    @ProtoNumber(1) var url: String,
    @ProtoNumber(2) var lastRead: Long,
    @ProtoNumber(3) var readDuration: Long = 0,
)
