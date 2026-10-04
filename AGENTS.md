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
- The repo root is the Omarchy plugin folder. `omarchy plugin add <git-url>` clones the whole repo into `~/.config/omarchy/plugins/<id>/` and validates the `manifest.json` at its root. So `manifest.json` stays at the root and its entry points name files in `plugin/`: a subfolder is allowed, `..` and an absolute path are not. The id is `aweiward.miharchy`; an id matches `[A-Za-z0-9][A-Za-z0-9._-]*` and never starts with `omarchy.`. Check with `omarchy plugin validate .`, which also refuses any symlink in the repo.
- Because the clone is the plugin folder, `plugin/` imports `../window/Model.js`, `../window/Updates.js` and `../window/Sync.js` directly. The shell loads only the entry point. It watches the plugin folder with inotify and reloads the plugin on any write there, so nothing may write inside an installed clone: no build, no cache, no state. `omarchy plugin update` also refuses a clone with local changes (`git merge --ff-only`).
- The mark polls `Updates.UPDATES_QUERY` once a minute and when the popup opens. Choosing an update runs `window/miharchy open-chapter <mangaId> <chapterId>`. The launcher calls the running window's `miharchy` IpcHandler (`quickshell ipc -p window call miharchy openChapter ...`); with no window running, it starts one with `MIHARCHY_OPEN_CHAPTER` set.
- `npm test` in `window/` also runs `plugin/tests/`. `lint:qml` leaves out `plugin/Mark.qml`: qmllint cannot resolve the shell's `qs.Commons` and `qs.Ui`.
- `window/` keeps decisions in pure JS modules, tested with node. QML files only wire those modules to the UI, the same split as the `aweiward.omaqbt` plugin in `~/.config/omarchy/plugins/`.
- `sync/` copies Mihon's backup model classes as the schema (ADR 0004). Keep them identical to upstream.
- Build and test `sync/` with `./gradlew test installDist` inside it (JDK 21+, nothing else). The CLI lands in `build/install/miharchy-sync/bin/`.
- `miharchy-sync sync [--folder <dir>] [--dry-run] [--json]` is the whole sync in one run. Without `--folder` it reads meta `miharchy.syncFolder` from the server, so the window and the popup start it the same way. It merges the newest phone backup in (none yet is fine), writes the desktop backup to the sync folder, and only then moves both baselines. A failure leaves the baselines alone, so the next sync retries.
- The helper reads `MIHARCHY_SERVER_JSON` like the window and the mark. Its state dir comes from `user.home`, so a test run sets both `MIHARCHY_SERVER_JSON` and `JAVA_OPTS=-Duser.home=<scratch home>`; otherwise it touches the real baselines.
- Backups Miharchy writes to the sync folder are named `miharchy-<UTC yyyy-MM-dd_HH-mm-ss>.tachibk`, so names sort by time. The sync ignores them when it picks the phone backup (the newest other `.tachibk`). It writes through a temp file that does not end in `.tachibk`, then renames it, and keeps the newest three. The backup leaves out Suwayomi's Default category, its client data and its server settings (the server password).
- Baselines and the lock file `sync.lock` live in `~/.local/share/miharchy/sync/` (mode 700). The helper holds the lock for its whole run; a second sync, from the popup or the window, exits with "A sync is already running." The OS drops the lock when the process ends, even on a crash.
- After a sync the helper lists what a stock Mihon restore cannot apply: the newest phone backup against the backup just written, because Mihon's restore keeps `favorite`, `read` and `bookmark` with OR, `lastPageRead` with max, and replaces categories only with a non-empty list. A desktop change stays listed until a later phone backup shows it.
- `window/Sync.js` runs the helper for both the window (`SyncView.qml`, `s` on Library and Updates, or the palette) and the popup (`s`). It runs the installed helper `~/.local/share/miharchy/helper/bin/miharchy-sync` (`Setup.HELPER_DIR`) first, then a dev checkout's `sync/build/install/miharchy-sync/bin/miharchy-sync` beside `window/` and `plugin/`.
- The Setup step "Sync helper" builds it after `y`: it copies the plugin's `sync/` (without `build/`, `.gradle/`, `.kotlin/`) to `~/.local/share/miharchy/sync-src/`, runs `./gradlew --no-daemon installDist` there, and swaps the install into `~/.local/share/miharchy/helper/` only when the build succeeds. `helper/source.sha256` is the fingerprint of the sources it was built from: sha256 over the sorted `sha256sum` lines of every file in `sync/` except those three folders (`Setup.FINGERPRINT`). The probe fingerprints the plugin's `sync/` the same way; a mismatch shows the step "out of date". Keep build output (`helper/`, `sync-src/`) apart from sync state (`sync/`).
- The Setup step "App launcher entry" writes `~/.local/share/applications/miharchy.desktop` (`Setup.desktopEntry`), with `Exec` on the plugin's `window/miharchy` and `Icon` on `window/miharchy.svg`. The Omarchy launcher reads XDG desktop entries. The probe compares the file byte for byte, so a moved plugin shows the step to do again.
- Suwayomi-Server runs as the systemd user service `miharchy-server`, from `~/.local/share/miharchy/suwayomi` (mode 700), on `127.0.0.1:4590` with `basic_auth`. `server/miharchy-server` sets it up and is safe to rerun.
- Every component reads the server address and credentials from `~/.config/miharchy/server.json` (mode 600): `{url, username, password}`. Never hard-code them.
- Suwayomi rewrites its `server.conf` with mode 644, so the 700 folder is what keeps the password private.
- Miharchy-only preferences live in Suwayomi global meta under `miharchy.<key>` (`metas` / `setGlobalMeta`), never in a local file, so the window, plugin and sync helper read one place. Settings that belong to Suwayomi stay server settings. `window/Settings.js` holds the row table: a new setting is one entry there.
- A preference for one manga lives in its manga meta under the same prefix (`setMangaMeta`). The reading mode `m` picks is `miharchy.readingMode`. It wins over a long strip detected from genre tags or a Webtoons source (`Browse.longStrip`), which wins over the default reading mode setting.
- Suwayomi cannot delete history: only a `lastPageRead` save moves `lastReadAt`. So History hides instead, never touching read state. An entry hides while its `lastReadAt` is at or below the manga meta `miharchy.historyHiddenAt` (remove) or the global meta `miharchy.historyClearedAt` (clear all). Both hold a server `lastReadAt`, so opening the chapter again brings it back. Backups still carry the full history.
- Browse adds the Keiyoushi extension repo once per server and records that in meta `miharchy.repoPreset`, so a repo the user removes stays removed. Suwayomi rewrites a repo's `index.min.json` URL to `index.pb` and ignores removal by any other URL, so remove a repo by the `indexUrl` the server returns.
- FlareSolverr is optional. The setup screen offers it as a Docker container bound to `127.0.0.1:8191` and then sets `flareSolverrEnabled` and `flareSolverrAsResponseFallback`. Without it, Cloudflare sources show a "needs FlareSolverr" message.
- The setup screen (`window/Setup.js`) changes the system only after the user presses y on a step, and it never runs an install command or sudo: it shows `pacman`/`yay` commands for the user to run. Each step detects "done" from a fresh check, so a rerun changes nothing. The sync folder lives in meta `miharchy.syncFolder`. A step's scripts address files through `$HOME`, so a test run with `HOME=<scratch>` (plus `JAVA_TOOL_OPTIONS=-Duser.home=<scratch>` for the JVMs) touches nothing real; `systemctl --user` ignores `HOME`, so stub it.

## Current work

v1 scope: browse and search, library and categories, reader (paged LTR/RTL, webtoon), downloads, extension repos, updates, and sync. Trackers and local manga come in v1.1.

The extension spike passed (`docs/spikes/extension-spike.md`), so ADR 0001 holds.

## Git

- Write commit messages and PR descriptions with no `Co-Authored-By:` line and no session trailer or link.
