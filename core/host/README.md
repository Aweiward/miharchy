# Extension host

The extension host runs Mihon extensions from their signed `.jar` builds: Android stand-in classes, the extension API, and a stdio JSON protocol (`src/main/kotlin/yomi/host/Main.kt`). ADR 0009 explains why Miharchy has it.

The code in this folder comes from [NanoYomi](https://github.com/SELECT-stupidity-FROM-discord/NanoYomi) `host/` at commit `4e9ac9b` (2026-11-20), under the Mozilla Public License 2.0 (`LICENSE-MPL-2.0.txt`). Miharchy's changes to those files stay under MPL-2.0 too. Miharchy added this README and the tests `CryptoTest` and `DataDirTest`. The Gradle wrapper, `settings.gradle.kts` and the dependency checksums now live in `core/`, for every module. `git log -- core/host` lists every change; the first commit is the unchanged copy.

Build and test from `core/`, with JDK 21 or newer:

```sh
./gradlew :host:installDist :host:test
```
