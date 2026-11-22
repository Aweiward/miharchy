import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm")
    kotlin("plugin.serialization")
    application
}

repositories {
    mavenCentral()
    maven("https://jitpack.io")
}

dependencies {
    implementation(project(":host"))
    // The same version as the host, which pins what extensions link against.
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
    implementation("io.ktor:ktor-server-cio:3.6.1")
    implementation("io.ktor:ktor-server-websockets:3.6.1")
    implementation("org.xerial:sqlite-jdbc:3.54.1.0")
    // The tracker clients (#371) call their sites directly; the version the host pins.
    implementation("com.squareup.okhttp3:okhttp:5.4.0")
    implementation("org.jsoup:jsoup:1.22.2")
    // sync/'s merge and backup classes (ADR 0010), from the included build in settings.gradle.kts.
    // Its newer kotlin-stdlib stays out, so core runs on the host's, which extensions link against.
    implementation("miharchy:miharchy-sync") { exclude(group = "org.jetbrains.kotlin", module = "kotlin-stdlib") }
    // Ktor logs through SLF4J; the same version as Ktor's slf4j-api. Logs go to stderr, so journald keeps them.
    runtimeOnly("org.slf4j:slf4j-simple:2.0.19")
    testImplementation("io.ktor:ktor-server-test-host:3.6.1")
    testImplementation(kotlin("test"))
}

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_21) }
}

application {
    applicationName = "miharchy-core"
    mainClass.set("miharchy.core.MainKt")
    applicationDefaultJvmArgs = listOf(
        // The host's Bitmap and Canvas use AWT, which must not open a window.
        "-Djava.awt.headless=true",
        // sqlite-jdbc loads its native library; JDK 24 and later warn, and later JDKs block it, without this.
        "--enable-native-access=ALL-UNNAMED",
        // ponytail: a fixed heap; size it to the machine, as NanoYomi does, if large libraries need more.
        "-Xmx256m", "-XX:+UseSerialGC",
    )
}

tasks.test {
    useJUnitPlatform()
    jvmArgs("-Djava.awt.headless=true", "--enable-native-access=ALL-UNNAMED")
}
