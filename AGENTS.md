# Miharchy

A manga reader for Omarchy (Arch + Hyprland). It reads Mihon's extension ecosystem through Suwayomi-Server and syncs with stock Mihon on a phone through backup files.

## Read first

- `CONTEXT.md` is the glossary. Use its terms in code, UI text and docs: **manga**, **source**, **read state**, **sync**, **view** and the rest. When a new term settles, add it there.
- `docs/adr/` holds the architecture decisions. Read the ADRs before changing how the parts fit together. A change that contradicts one needs a new ADR that supersedes it.

## Architecture

```
 Omarchy shell                Window process               localhost only
 ┌──────────────────┐        ┌───────────────────┐  GraphQL ┌──────────────────┐
 │ plugin/ (QML)    │ opens  │ window/ (QML+JS)  │ ───────► │ Suwayomi-Server  │
 │ mark + popup     │ ─────► │ views + reader    │          │ systemd --user   │
 └──────────────────┘        └─────────┬─────────┘          └──────────────────┘
                                       │ runs                        ▲
                                       ▼                             │ GraphQL
                             ┌───────────────────┐                   │
                             │ sync/ (Kotlin CLI)│ ──────────────────┘
                             │ three-way merge   │ ◄── sync folder (.tachibk)
                             └───────────────────┘
```

- `plugin/` stays thin: the mark, the popup, a launcher. The reader never runs inside the shell process (ADR 0003).
- `window/` keeps decisions in pure JS modules, tested with node. QML files only wire those modules to the UI, the same split as the `aweiward.omaqbt` plugin in `~/.config/omarchy/plugins/`.
- `sync/` copies Mihon's backup model classes as the schema (ADR 0004). Keep them identical to upstream.
- Build and test `sync/` with `./gradlew test installDist` inside it (JDK 21+, nothing else). The CLI lands in `build/install/miharchy-sync/bin/`.
- Backups Miharchy writes to the sync folder are named `miharchy-*.tachibk`. `ingest` ignores them and takes the newest other `.tachibk` as the phone backup. Baselines live in `~/.local/share/miharchy/sync/` (mode 700).
- Suwayomi-Server runs as the systemd user service `miharchy-server`, from `~/.local/share/miharchy/suwayomi` (mode 700), on `127.0.0.1:4590` with `basic_auth`. `server/miharchy-server` sets it up and is safe to rerun.
- Every component reads the server address and credentials from `~/.config/miharchy/server.json` (mode 600): `{url, username, password}`. Never hard-code them.
- Suwayomi rewrites its `server.conf` with mode 644, so the 700 folder is what keeps the password private.
- Miharchy-only preferences live in Suwayomi global meta under `miharchy.<key>` (`metas` / `setGlobalMeta`), never in a local file, so the window, plugin and sync helper read one place. Settings that belong to Suwayomi stay server settings. `window/Settings.js` holds the row table: a new setting is one entry there.
- Browse adds the Keiyoushi extension repo once per server and records that in meta `miharchy.repoPreset`, so a repo the user removes stays removed. Suwayomi rewrites a repo's `index.min.json` URL to `index.pb` and ignores removal by any other URL, so remove a repo by the `indexUrl` the server returns.
- FlareSolverr is optional. The setup screen offers it as a Docker container bound to `127.0.0.1:8191` and then sets `flareSolverrEnabled` and `flareSolverrAsResponseFallback`. Without it, Cloudflare sources show a "needs FlareSolverr" message.
- The setup screen (`window/Setup.js`) changes the system only after the user presses y on a step, and it never runs an install command or sudo: it shows `pacman`/`yay` commands for the user to run. Each step detects "done" from a fresh check, so a rerun changes nothing. The sync folder lives in meta `miharchy.syncFolder`.

## Current work

v1 scope: browse and search, library and categories, reader (paged LTR/RTL, webtoon), downloads, extension repos, updates, and sync. Trackers and local manga come in v1.1.

The extension spike passed (`docs/spikes/extension-spike.md`), so ADR 0001 holds.

## Git

- Write commit messages and PR descriptions with no `Co-Authored-By:` line and no session trailer or link.
