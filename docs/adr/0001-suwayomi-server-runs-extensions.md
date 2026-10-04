# Suwayomi-Server runs extensions; Miharchy is its frontend

Mihon extensions are Android APKs. They need a JVM, dex-to-jar conversion and an Android shim to run on Linux. Suwayomi-Server already does all of this, along with downloads, trackers and Mihon-compatible backups. Miharchy runs Suwayomi-Server as a localhost backend and spends its effort on the reading experience.

## Considered Options

- Fork Suwayomi's AndroidCompat layer into our own extension host. Rejected for v1: it re-solves a solved problem and must track every extension lib change.
- Rewrite sources natively. Rejected: it drops the whole extension ecosystem.

## Consequences

- Users need Java 21 or newer.
- Cloudflare-protected sources use Suwayomi's Chromium (JCEF), which runs under XWayland.
- New extension lib versions (for example Keiyoushi's 1.6 `KeiSource`) work only after Suwayomi supports them.
- Known risk (Oct 2026): Suwayomi issue #2298 says dex-to-jar emits invalid bytecode for extensions built with Kotlin 2.x, which may cover all recent Keiyoushi builds. Issue #2347 says the new `runWebView` helpers time out. If these stay broken, this ADR gets revisited.
