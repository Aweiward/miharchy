// Copied from mihonapp/mihon@7aacaa349019ff42b8b05403d8beebe94c8f6dfc
// app/src/main/java/eu/kanade/tachiyomi/data/backup/models/BackupExtensionStore.kt
// Licensed under Apache-2.0. Mappers to Mihon domain types are removed; the schema is unchanged.

package eu.kanade.tachiyomi.data.backup.models

import kotlinx.serialization.Serializable
import kotlinx.serialization.protobuf.ProtoNumber

@Serializable
class BackupExtensionStore(
    @ProtoNumber(1) var indexUrl: String,
    @ProtoNumber(2) var name: String,
    @ProtoNumber(3) var badgeLabel: String?,
    @ProtoNumber(5) var signingKey: String,
    @ProtoNumber(4) var contactWebsite: String,
    @ProtoNumber(6) var contactDiscord: String?,
    @ProtoNumber(7) var isLegacy: Boolean?,
    @ProtoNumber(8) var extensionListUrl: String?,
)
