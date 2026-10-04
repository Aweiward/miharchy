// Copied from mihonapp/mihon@7aacaa349019ff42b8b05403d8beebe94c8f6dfc
// app/src/main/java/eu/kanade/tachiyomi/data/backup/models/BackupCategory.kt
// Licensed under Apache-2.0. Mappers to Mihon domain types are removed; the schema is unchanged.

package eu.kanade.tachiyomi.data.backup.models

import kotlinx.serialization.Serializable
import kotlinx.serialization.protobuf.ProtoNumber

@Serializable
class BackupCategory(
    @ProtoNumber(1) var name: String,
    @ProtoNumber(2) var order: Long = 0,
    @ProtoNumber(3) var id: Long = 0,
    // @ProtoNumber(3) val updateInterval: Int = 0, 1.x value not used in 0.x
    @ProtoNumber(100) var flags: Long = 0,
)
