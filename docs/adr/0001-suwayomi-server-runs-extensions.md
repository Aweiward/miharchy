# Suwayomi-Server runs extensions; Miharchy is its frontend

Mihon extensions are Android APKs. They need a JVM, dex-to-jar conversion and an Android shim to run on Linux. Suwayomi-Server already does all of this, along with downloads, trackers and Mihon-compatible backups. Miharchy runs Suwayomi-Server as a localhost backend and spends its effort on the reading experience.

## Considered Options

- Fork Suwayomi's AndroidCompat layer into our own extension host. Rejected for v1: it re-solves a solved problem and must track every extension lib change.
- Rewrite sources natively. Rejected: it drops the whole extension ecosystem.

## Consequences

- Users need Java 21 or newer.
- Cloudflare-protected sources use Suwayomi's Chromium (JCEF), which runs under XWayland.
- New extension lib versions (for example Keiyoushi's 1.6 `KeiSource`) work only after Suwayomi supports them.
- Suwayomi issues #2298 (Kotlin 2.x bytecode) and #2347 (`runWebView`) looked like blockers. The 2026-10-04 spike (`docs/spikes/extension-spike.md`) ran 10 current lib 1.6 extensions: 9 passed, and the failure was a dead site.
- Cloudflare-protected sources need FlareSolverr (or Byparr) beside Suwayomi, with `flareSolverrAsResponseFallback` on.
