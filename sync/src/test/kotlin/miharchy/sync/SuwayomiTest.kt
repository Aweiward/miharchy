package miharchy.sync

import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

private const val UNAUTHORIZED = "Exception while fetching data (/metas) : Unauthorized\r\n\r\nsuwayomi.tachidesk.server.user.UnauthorizedException: Unauthorized"

class SuwayomiTest {
    @Test fun `only an Unauthorized error or a 401 refuses the token`() {
        assertTrue(refusedToken(200, buildJsonObject { putJsonArray("errors") { add(buildJsonObject { put("message", UNAUTHORIZED) }) } }.toString()))
        assertTrue(refusedToken(401, ""))
        assertFalse(refusedToken(200, """{"errors":[{"message":"Exception while fetching data (/x) : Not Unauthorized here"}]}"""))
        assertFalse(refusedToken(200, """{"data":{}}"""))
        assertFalse(refusedToken(200, "<html>"))
        assertFalse(refusedToken(500, ""))
    }
}
