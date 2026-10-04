// Copied from mihonapp/mihon@7aacaa349019ff42b8b05403d8beebe94c8f6dfc
// app/src/main/java/eu/kanade/tachiyomi/data/backup/models/BackupChapter.kt
// Licensed under Apache-2.0. Mappers to Mihon domain types are removed; the schema is unchanged.

package eu.kanade.tachiyomi.data.backup.models

import kotlinx.serialization.Serializable
import kotlinx.serialization.protobuf.ProtoNumber
import mihon.core.common.extensions.JsonObjectEmptyBytes

@Serializable
class BackupChapter(
    // in 1.x some of these values have different names
    // url is called key in 1.x
    @ProtoNumber(1) var url: String,
    @ProtoNumber(2) var name: String,
    @ProtoNumber(3) var scanlator: String? = null,
    @ProtoNumber(4) var read: Boolean = false,
    @ProtoNumber(5) var bookmark: Boolean = false,
    // lastPageRead is called progress in 1.x
    @ProtoNumber(6) var lastPageRead: Long = 0,
    @ProtoNumber(7) var dateFetch: Long = 0,
    @ProtoNumber(8) var dateUpload: Long = 0,
    // chapterNumber is called number is 1.x
    @ProtoNumber(9) var chapterNumber: Float = 0F,
    @ProtoNumber(10) var sourceOrder: Long = 0,
    // @ProtoNumber(11) var lastModifiedAt: Long, artifact of the abandoned sync attempt
    // @ProtoNumber(12) var version: Long, artifact of the abandoned sync attempt
    @ProtoNumber(13) var memo: ByteArray = JsonObjectEmptyBytes,
)
