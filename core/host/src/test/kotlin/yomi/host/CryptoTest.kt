package yomi.host

import org.junit.jupiter.api.Test
import javax.crypto.Cipher

class CryptoTest {
    // Android ships BouncyCastle, and Mangago decrypts its pages with this cipher.
    @Test
    fun androidCiphersAreAvailable() {
        installCryptoProviders()
        Cipher.getInstance("AES/CBC/ZEROBYTEPADDING")
    }
}
