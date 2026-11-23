package miharchy.sync

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals

class BackupFolderTest {
    // window/tests/settings.test.js reads the same file, so Settings refuses exactly what the helper refuses.
    @Test fun `the backup folder is refused only when it normalizes to the sync folder`() {
        val cases = Json.parseToJsonElement(javaClass.getResource("/backup-folder-cases.json")!!.readText()).jsonArray
        for (case in cases.map { it.jsonObject }) {
            val backup = case.getValue("backup").jsonPrimitive.content
            val sync = case.getValue("sync").jsonPrimitive.contentOrNull
            val expected = if (case.getValue("refused").jsonPrimitive.boolean) "$backup is the sync folder. Choose another backup folder in Settings." else null
            assertEquals(expected, backupRefusal(backup, sync), "$backup against $sync")
        }
    }
}
