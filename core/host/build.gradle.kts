import org.jetbrains.kotlin.gradle.dsl.JvmDefaultMode
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm")
    application
}

repositories {
    mavenCentral()
    maven("https://jitpack.io")
}

// Versions match what keiyoushi extensions are compiled against (extensions-source/gradle/libs.versions.toml).
dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json-okio:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-protobuf:1.11.0")
    implementation("com.squareup.okhttp3:okhttp:5.4.0")
    implementation("com.squareup.okhttp3:okhttp-brotli:5.4.0")
    implementation("com.squareup.okhttp3:okhttp-zstd:5.4.0")
    implementation("org.jsoup:jsoup:1.22.2")
    // Android ships BouncyCastle, and some extensions use its ciphers (Mangago: AES/CBC/ZEROBYTEPADDING).
    implementation("org.bouncycastle:bcprov-jdk18on:1.80")
    // Android ships org.json and extensions use it (Comix calls JSONObject.quote).
    implementation("org.json:json:20250517")
    implementation("com.github.mihonapp:injekt:91edab2317")
    // QuickJS on the JVM, for extensions that run a site's JavaScript.
    implementation("org.mozilla:rhino:1.7.15")
    // WebP for BitmapFactory, which ImageIO can't read alone. Pure Java.
    implementation("com.twelvemonkeys.imageio:imageio-webp:3.12.0")
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
        // Same interface layout as extensions-lib (default methods + DefaultImpls), so extensions link against us.
        jvmDefault.set(JvmDefaultMode.ENABLE)
    }
}

application {
    mainClass.set("yomi.host.MainKt")
    // About 100 MB with MangaDex loaded. The metaspace headroom is for many extensions at once.
    applicationDefaultJvmArgs = listOf(
        // Bitmap and Canvas use AWT, which mustn't open a window or a Dock icon.
        "-Djava.awt.headless=true",
        "-Xmx64m", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1", "-Xss256k",
        "-XX:ReservedCodeCacheSize=24m", "-XX:MaxMetaspaceSize=96m",
    )
}

tasks.test {
    useJUnitPlatform()
    jvmArgs("-Djava.awt.headless=true")
}
