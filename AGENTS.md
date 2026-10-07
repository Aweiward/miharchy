# Miharchy

A manga reader for Omarchy (Arch + Hyprland). It reads Mihon-compatible extensions through Suwayomi-Server and syncs with stock Mihon on a phone through backup files.

## Read first

- `GLOSSARY.md` is the glossary. Use its terms in code, UI text and docs: **manga**, **source**, **read state**, **sync**, **view** and the rest. When a new term settles, add it there.
- `docs/adr/` holds the architecture decisions. Read the ADRs before changing how the parts fit together. A change that contradicts one needs a new ADR that supersedes it.
- Verify a change with the `verify-miharchy` skill (`.claude/skills/verify-miharchy/`): a scratch server, the real window driven offscreen, GraphQL read-backs. Use it before claiming a window, sync or server change works.

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
- The repo root is the Omarchy plugin folder. `omarchy plugin add <git-url>` clones the whole repo into `~/.config/omarchy/plugins/<id>/` and validates the `manifest.json` at its root. So `manifest.json` stays at the root and its entry points name files in `plugin/`: a subfolder is allowed, `..` and an absolute path are not. The id is `miharchy` (Omarchy needs no author prefix, only an id that is unique among installed plugins); an id matches `[A-Za-z0-9][A-Za-z0-9._-]*` and never starts with `omarchy.`. Check with `omarchy plugin validate .`, which also refuses any symlink in the repo.
- Because the clone is the plugin folder, `plugin/` imports `../window/Model.js`, `../window/Updates.js` and `../window/Sync.js` directly. The shell loads only the entry point. It watches the plugin folder with inotify and reloads the plugin on any write there, so nothing may write inside an installed clone: no build, no cache, no state. The reload reuses the shell's cached QML and JS (omacom/omarchy#6981), so new `plugin/` code, and the `window/*.js` it imports, runs only after `omarchy-restart-shell`. Until then the mark runs the old code: after the move to token login (ADR 0005) it still sent Basic auth and showed a server error. `omarchy plugin update` also refuses a clone with local changes (`git merge --ff-only`).
- `npm test` in `window/` also runs `plugin/tests/`. `lint:qml` leaves out `plugin/Mark.qml`: qmllint cannot resolve the shell's `qs.Commons` and `qs.Ui`.
- `window/` keeps decisions in pure JS modules, tested with node. QML files only wire those modules to the UI, the same split as the `aweiward.omaqbt` plugin in `~/.config/omarchy/plugins/`.
- `sync/` copies Mihon's backup model classes as the schema (ADR 0004). Keep them identical to upstream.
- Build and test `sync/` with `./gradlew test installDist` inside it (JDK 21+, nothing else). The CLI lands in `build/install/miharchy-sync/bin/`.
- Every component reads the server address and credentials from `~/.config/miharchy/server.json` (mode 600): `{url, username, password}`. Never hard-code them.
- Miharchy-only preferences live in Suwayomi global meta under `miharchy.<key>` (`metas` / `setGlobalMeta`), never in a local file, so the window, plugin and sync helper read one place. Settings that belong to Suwayomi stay server settings. `window/Settings.js` holds the row table: a new setting is one entry there.

## Subsystem docs

Read the doc for the area before you change it.

- **Bar mark, popup, launcher, notifications** (`plugin/`, `window/miharchy`): `docs/agents/plugin.md`.
- **Window views, mouse, Settings, modes, preferences, reader chapter list, restart** (`window/`): `docs/agents/window.md`.
- **Library updates, categories, downloads, Migrate, History**: `docs/agents/library.md`.
- **Browse, local manga, extensions, source filters, FlareSolverr**: `docs/agents/sources.md`.
- **Trackers** (`Trackers.js`, `TrackPanel.qml`, progress pushes): `docs/agents/trackers.md`.
- **Sync, backups, restore** (`sync/`, `Sync.js`, `Backup.js`, `Restore.js`): `docs/agents/sync.md`.
- **Suwayomi-Server, credentials, server images** (`server/`, `ServerImage.qml`): `docs/agents/server.md`.
- **Setup steps** (`Setup.js`, helper build, launcher entry): `docs/agents/setup.md`.

## Current work

The v1 base is built and merged. The work now is Mihon parity for v1.0.0, tracked in #134 (milestone v1.0.0). Every parity item but one is merged. Before v1.0.0, Miharchy moves to token login and pins the Suwayomi version (ADR 0005). Logging in to a source in a WebView (#98) left the milestone: it waits for an upstream Suwayomi change. Outside the milestone, the AUR package (#43) is open and ships after token login. Check `gh issue list --milestone v1.0.0` for the current list, and work items through `ready-for-agent` issues.

Verified on the user's phone (2026-10-04): stock Mihon restores a `miharchy-*.tachibk` export from a real 216-manga library without issues. The FlareSolverr Setup step ran on the user's machine; `docs/spikes/cloudflare-solvers.md` compares it with Byparr.

## Git

- Write commit messages and PR descriptions with no `Co-Authored-By:` line and no session trailer or link.
