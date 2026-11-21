# Extension host

The extension host runs Mihon extensions from their signed `.jar` builds: Android stand-in classes, the extension API, and a stdio JSON protocol (`src/main/kotlin/yomi/host/Main.kt`). ADR 0009 explains why Miharchy has it.

Every file in this folder comes from [NanoYomi](https://github.com/SELECT-stupidity-FROM-discord/NanoYomi) `host/` at commit `4e9ac9b` (2026-11-20). They stay under the Mozilla Public License 2.0 (`LICENSE-MPL-2.0.txt`), and so do Miharchy's changes to them. `git log -- core/host` lists those changes; the first commit is the unchanged copy.

Build and test with JDK 21 or newer:

```sh
./gradlew installDist test
```
