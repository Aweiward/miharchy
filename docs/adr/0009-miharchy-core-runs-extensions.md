# Miharchy runs extensions in its own core service, not in Suwayomi-Server

Status: accepted (2026-11-21). Supersedes ADR 0001.

ADR 0001 rejected an extension host of our own, because it had to convert Android dex files and track every extension lib change. Two facts changed that. First, Keiyoushi now publishes a signed `.jar` for each of its 1,711 extensions, so no dex conversion is needed. Second, NanoYomi (MPL-2.0) ships a small JVM extension host: about 5,000 lines of Kotlin and Java, with Android stand-in classes that lib 1.6 extensions link against. The 2026-11-21 spike (`docs/spikes/nano-host-spike.md`) ran the same 10 sources as the October spike. 9 passed with two small host changes.

Miharchy therefore replaces Suwayomi-Server with **miharchy-core**: one Kotlin service that owns all state and runs extensions in-process.

- miharchy-core lives in `core/`, outside `sync/`. Setup fingerprints every file in `sync/` to decide when the sync helper is out of date, so core code there would ask every user to rebuild the helper. Core reuses `sync/`'s Mihon backup classes and tested merge; whether `sync/` later merges into core is open (#359).
- It copies NanoYomi's host code and calls it in the same JVM. It does not use the host's stdio protocol.
- It keeps the library, chapters, categories and metas in SQLite.
- It runs the download queue, library update runs and tracker clients.
- It serves the window, the bar plugin and the sync CLI over HTTP on `127.0.0.1`, with one WebSocket for live updates, and runs as the `miharchy-server` user service.
- On a Cloudflare challenge, it asks FlareSolverr for the page and uses the response body as the reply, as Suwayomi's `flareSolverrAsResponseFallback` does.
- It does not provide a WebView. An extension that needs a hidden WebView fails with a clear error.

## Considered Options

- Keep Suwayomi-Server (ADR 0001). Rejected: Miharchy pins a Suwayomi version for token login (ADR 0005), works around its restore (ADR 0004), and runs a heavy server with JCEF under XWayland. It also gets new extension lib support only when Suwayomi ships it.
- Run NanoYomi's host as a stdio child of the window. Rejected: the bar plugin and the sync CLI also need the state, and updates and downloads must run while the window is closed.
- Add a WebView bridge (Qt WebEngine or headless Chromium) now. Deferred: in the spike, only AllManga needed it. Revisit when users report WebView-only sources they need.
- Depend on NanoYomi as a library. Rejected: it is a few days old with one main author, and its host is not published as a library. Miharchy copies the files and maintains them.

## Consequences

- Sources that need a hidden WebView stop working. In the spike, that is AllManga.
- Cloudflare-protected sources still need FlareSolverr (or Byparr), so the FlareSolverr Setup step stays.
- The host needs BouncyCastle as a JCE provider, because Android ships it and some extensions (Mangago) use its ciphers.
- The copied NanoYomi files keep their MPL-2.0 headers, and Miharchy ships the MPL-2.0 text, as it does with Mihon's Apache-2.0 text. The rest of Miharchy stays MIT.
- JDK 21+ stays a requirement. The `suwayomi-server-bin` package and the Suwayomi version pin go away.
- Trackers need Miharchy's own OAuth app registrations. Today's OAuth login ends on a `suwayomi.org` page, which belongs to Suwayomi's apps. NanoYomi has clients only for MyAnimeList and AniList; Kitsu, Shikimori, Bangumi and MangaUpdates must be written.
- ADR 0004 gets simpler: the merge writes to Miharchy's own database, so the split between `restoreBackup` and GraphQL mutations goes away.
- ADR 0005 goes away: miharchy-core listens on `127.0.0.1` only. It needs no login, but every request carries a shared secret, because any local user can open a `127.0.0.1` port (ADR 0010).
- Every GraphQL call in `window/`, `plugin/Mark.js` and `sync/` moves to the new API (about 50 operations).
- Users on v1.1.1 move once: Setup exports a `.tachibk` from Suwayomi and imports it into miharchy-core. Miharchy's own metas do not travel in a backup: the Settings rows stored in global meta, and the manga notes in meta (`Desktop.kt`: Suwayomi's backups have no notes field). Setup copies all metas over GraphQL before Suwayomi stops.
- Extension installs move to `jarUrl`. A repo without jar builds cannot be used.
