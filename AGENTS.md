# Miharchy

A manga reader for Omarchy (Arch + Hyprland). It reads Keiyoushi extensions through its own server, miharchy-core, and syncs with stock Mihon on a phone through backup files.

## Read first

- `GLOSSARY.md` is the glossary. Use its terms in code, UI text and docs: **manga**, **source**, **read state**, **sync**, **view** and the rest. When a new term settles, add it there.
- `docs/adr/` holds the architecture decisions. Read the ADRs before changing how the parts fit together. A change that contradicts one needs a new ADR that supersedes it.
- Verify a change with the `verify-miharchy` skill (`.claude/skills/verify-miharchy/`): a scratch miharchy-core, the real window driven offscreen, read-backs through core's routes. Use it before claiming a window, sync or server change works.

## Architecture

```
 Omarchy shell                Window process               localhost only
 ┌──────────────────┐        ┌───────────────────┐  routes  ┌──────────────────────┐
 │ plugin/ (QML)    │ opens  │ window/ (QML+JS)  │ ───────► │ core/ miharchy-core  │
 │ mark + popup     │ ─────► │ views + reader    │          │ systemd --user, 4591 │
 └────────┬─────────┘        └───────────────────┘          │ extensions, SQLite   │
          │ routes                                          │ sync/ (library):     │
          └───────────────────────────────────────────────► │ three-way merge      │
                                                            └──────────┬───────────┘
                                                                     ▼ ▲ .tachibk
                                                              sync folder (phone)
```

- `plugin/` stays thin: the mark, the popup, a launcher. The reader never runs inside the shell process (ADR 0003).
- The repo root is the Omarchy plugin folder. `omarchy plugin add <git-url>` clones the whole repo into `~/.config/omarchy/plugins/<id>/` and validates the `manifest.json` at its root. So `manifest.json` stays at the root and its entry points name files in `plugin/`: a subfolder is allowed, `..` and an absolute path are not. The id is `miharchy` (Omarchy needs no author prefix, only an id that is unique among installed plugins); an id matches `[A-Za-z0-9][A-Za-z0-9._-]*` and never starts with `omarchy.`. Check with `omarchy plugin validate .`, which also refuses any symlink in the repo. Users install from `stable`, not `main` (ADR 0008): `tools/release-stable` moves it at each release, and its tree leaves out the files only agents use, and the site's trailer video, so nothing a user runs may need them. PRs target `main`: pass `--base main` to `gh pr create`.
- Because the clone is the plugin folder, `plugin/` imports `../window/Model.js`, `../window/Updates.js` and `../window/Sync.js` directly. The shell loads only the entry point. It watches the plugin folder with inotify and reloads the plugin on any write there, so nothing may write inside an installed clone: no build, no cache, no state. The reload reuses the shell's cached QML and JS (omacom/omarchy#6981), so new `plugin/` code, and the `window/*.js` it imports, runs only after `omarchy-restart-shell`. Until then the mark runs the old code. `omarchy plugin update` also refuses a clone with local changes (`git merge --ff-only`).
- `npm test` in `window/` also runs `plugin/tests/`. `lint:qml` leaves out `plugin/Mark.qml`: qmllint cannot resolve the shell's `qs.Commons` and `qs.Ui`.
- `window/` keeps decisions in pure JS modules, tested with node. QML files only wire those modules to the UI, the same split as the `aweiward.omaqbt` plugin in `~/.config/omarchy/plugins/`.
- `sync/` copies Mihon's backup model classes as the schema (ADR 0004). Keep them identical to upstream.
- `sync/` is a library that core builds (`includeBuild("../sync")`). Test it with `./gradlew test` inside it, and core with `./gradlew installDist test` inside `core/` (JDK 21+, nothing else).
- The window and the mark read core's address and secret from `~/.config/miharchy/core.json` (mode 600, core writes it): `{url, secret}`. Never hard-code them.
- Miharchy-only preferences live in core's global meta under `miharchy.<key>` (`meta.get` / `meta.set`), never in a local file, so the window, the mark and core read one place. Server settings (`settings.get` / `settings.set`) are core's own. `window/Settings.js` holds the row table: a new setting is one entry there.

## Subsystem docs

Read the doc for the area before you change it.

- **Bar mark, popup, launcher, notifications** (`plugin/`, `window/miharchy`): `docs/agents/plugin.md`.
- **Window views, mouse, Settings, modes, preferences, reader chapter list, restart** (`window/`): `docs/agents/window.md`.
- **Library updates, categories, downloads, Migrate, History, the library check**: `docs/agents/library.md`.
- **Browse, local manga, extensions, source filters, FlareSolverr**: `docs/agents/sources.md`.
- **Trackers** (`Trackers.js`, `TrackPanel.qml`, progress pushes): `docs/agents/trackers.md`.
- **Sync, backups, restore** (`sync/`, `Sync.js`, `Backup.js`, `Restore.js`): `docs/agents/sync.md`.
- **miharchy-core, its secret, server images** (`core/`, `Session.js`, `ServerImage.qml`): `docs/agents/server.md`.
- **Setup steps** (`Setup.js`, core build, the move, launcher entry): `docs/agents/setup.md`.
- **Release** (version bump, tag, notes, site): `docs/agents/release.md`.
- **miharchy-core routes** (`core/`): `core/README.md`, ADR 0009 and ADR 0010.

## Current work

The latest release is [v1.2.0](https://github.com/Aweiward/miharchy/releases/tag/v1.2.0) (2026-11-22). Its release notes list what shipped. Users install from `stable` (ADR 0008); work and PRs stay on `main`. The open plan is the Omarchy Plugin Marketplace listing (#331): v1.2.0 (`stable` at `404e8ff`) replaced v1.1.1 in the review on 2026-11-22; leave `stable` alone until it is listed, and answer review findings within 7 days. New work starts with a grilling session. miharchy-core replaced Suwayomi-Server (ADR 0009, #373). Logging in to a source in a WebView (#98) now waits for a WebView bridge in core (ADR 0009). Work items through `ready-for-agent` issues.

## Agent skills

### Issue tracker

GitHub Issues on Aweiward/miharchy, through `gh` with the Aweiward token. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.

## Git

- Write commit messages and PR descriptions with no `Co-Authored-By:` line and no session trailer or link.
