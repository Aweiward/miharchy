---
name: verify-miharchy
description: Drive Miharchy's real window (Quickshell/QML) offscreen against a throwaway Suwayomi-Server, and read results back over GraphQL, to prove a window or sync change works. Use after changing anything in window/, sync/ or server/, before claiming a feature works, or to reproduce a bug. Never touches the user's real server (port 4590), desktop, or ~/.config/omarchy.
---

# verify-miharchy

Miharchy's user surface is the window (`window/`, Quickshell QML), backed by Suwayomi-Server over GraphQL, plus the sync helper CLI (`sync/`) and a bar plugin (`plugin/`). Proof means: drive the **real** window code through the same command path keys use (`root.handleKey`, command ids), then confirm the **server state** changed (GraphQL read-back), with captures of what the window showed.

Hard rules, from incidents on this project:
- Never use the user's server: port 4590, `~/.config/miharchy/server.json`, `~/.local/share/miharchy`. Every run gets its own server on its own port and its own run dir.
- Never open windows on the desktop or send keystrokes to it (a safety check blocks it; the user is working). Everything runs with `QT_QPA_PLATFORM=offscreen`.
- Never kill by process name. `pkill -f <pattern>` matches its own command line and has killed the shell running it here. `server.sh stop` kills by PID file and by this run's server dir only.
- Never edit `~/.config/omarchy/` or restart the live shell.
- Never print a process's whole environment (`/proc/<pid>/environ`, `env`): it holds the session's tokens. Check one variable, e.g. `tr '\0' '\n' < /proc/<pid>/environ | grep '^XDG_RUNTIME_DIR='`.

Run each script as one plain command from the worktree root, e.g. `.claude/skills/verify-miharchy/scripts/server.sh start`: no `export`, no `cd`, no `VAR=...;` prefix. Shell state does not persist between Bash calls, and the scripts need none. Each script reads `scripts/env.sh`, which sets the run dir to `${TMPDIR:-/tmp}/miharchy-verify/<worktree folder name>`, so every worktree gets its own run. `start` picks a free port (never 4590) and keeps it in `$RUN/port`; every later script of that run reads it. `start` and `doctor` print the run dir: use that literal path wherever this skill says `$RUN`.

Runs must never share a run dir: `stop` kills whatever server that dir recorded, and the window copy in `$RUN/app` would be overwritten. Parallel agents in separate worktrees get separate dirs on their own. Two runs in the **same** worktree need `MIHARCHY_VERIFY_DIR=<another dir>` on every command of the second run. `MIHARCHY_VERIFY_PORT` still forces a port. `start` refuses a dir whose recorded server is still running.

## Launch

```sh
.claude/skills/verify-miharchy/scripts/server.sh start     # ~30–60 s; prints "ready: Suwayomi v… on 127.0.0.1:<port> (pid N), run dir <RUN>"
.claude/skills/verify-miharchy/scripts/seed.sh --library 2 # Keiyoushi repo + MangaDex, 2 popular manga in the library
.claude/skills/verify-miharchy/scripts/seed.sh eu.kanade.tachiyomi.extension.en.weebcentral   # more extensions by pkgName
.claude/skills/verify-miharchy/scripts/seed.sh --updates 2  # 2 latest manga whose chapters count as Updates rows
.claude/skills/verify-miharchy/scripts/seed.sh --hold-queue 4,5,6   # those chapters queued, downloader stopped; fails when the queue does not hold
```

The server is `/usr/bin/suwayomi-server` (AUR `suwayomi-server-bin`) with `-Dsuwayomi.tachidesk.config.server.rootDir=$RUN/server` and `-Djava.io.tmpdir=$RUN/server/tmp` (its page and cover cache; the default `/tmp/Tachidesk` is the user's server's too), `ui_login` with random credentials written to `$RUN/server.json`, as Miharchy runs its own server (ADR 0005). Ready = a login with those credentials succeeds and its access token reads `aboutServer{version}` and `mangas`. Access tokens last 5 minutes; `MIHARCHY_VERIFY_TOKEN_EXPIRY=30s` on `start` shortens them (`server.jwtTokenExpiry`), so a drive can outlive one and prove the refresh. `gql.sh` logs in on each call (`token` in `env.sh`). `start` returns then: the server runs detached (`setsid -f`, its own session, output in `$RUN/server.log`), so `server.sh start | tee` and a backgrounded `start` both end. A fresh server downloads JCEF (~250 MB) on first start into its root dir; that is normal.

The sync helper builds once per checkout: `sync/gradlew -p sync installDist` → `sync/build/install/miharchy-sync/bin/miharchy-sync`. Run it against the scratch server with `JAVA_OPTS=-Duser.home=$RUN/home MIHARCHY_SERVER_JSON=$RUN/server.json`. For the window's sync, backup and restore, copy the build into `$RUN/home/.local/share/miharchy/helper/` (`cp -r sync/build/install/miharchy-sync/. $RUN/home/.local/share/miharchy/helper/`).

`server.sh restart` stops and starts the same instance: same port, credentials and library. Use it to prove the window reconnects after a server restart; `stop` then `start` wipes the library and changes the credentials.

## Live updates

The download queue and Updates follow GraphQL subscriptions over a WebSocket (`window/LiveSocket.qml`), which needs `qt6-websockets`. Without the module the window still runs, with nothing live, and logs "Live updates need qt6-websockets". When it is not installed, extract the Arch package into a scratch dir (`pacman -Sp qt6-websockets` gives the URL; check the `.sig` with `pacman-key --verify`) and run `drive.sh` with `QML_IMPORT_PATH=<dir>/usr/lib/qt6/qml LD_LIBRARY_PATH=<dir>/usr/lib` in front: one of the two places a `VAR=...` prefix belongs; the other is a start target (`MIHARCHY_PEEK=1`, `MIHARCHY_OPEN_VIEW=updates`, `MIHARCHY_OPEN_CHAPTER="<mangaId> <chapterId>"`), which `drive.sh` passes through to the window as the launcher would set it. Each drive overwrites `$RUN/evidence/drive.log`, so copy it to its own name before the next drive. To show that nothing polls, point the drive at a logging proxy: write a copy of `$RUN/server.json` whose `url` is the proxy's port over `$RUN/server.json` (`gql.sh` and `server.sh` use `$RUN/port`, not the url), and log each request and WebSocket upgrade. Start the server with `MIHARCHY_VERIFY_TOKEN_EXPIRY=40s` to keep a socket open past its token, and run `server.sh restart` while a drive runs in the background to prove the reconnect. A library update only shows progress when the seeded manga pass the skip filters: `setSettings` with `excludeUnreadChapters`, `excludeNotStarted` and `excludeCompleted` false.

## Doctor

```sh
.claude/skills/verify-miharchy/scripts/server.sh doctor    # "ok: pid N owns <port>, Suwayomi v…, request without a token -> Unauthorized, run dir <RUN>"
```
Run it first whenever anything looks off. It fails if the PID file is missing, the process is dead, another process owns the port, the login fails, or auth is not enforced.

## Drive

```sh
.claude/skills/verify-miharchy/scripts/drive.sh steps.js 90     # copies window/ into $RUN/app, appends the driver, runs it offscreen for ≤ 90 s
```
`drive.sh` patches the copy with `scripts/patch-window.py` (both Setup jumps off, `import QtTest`, the driver) and runs it through `window_env` in `env.sh`: `HOME=$RUN/home`, `JAVA_OPTS=-Duser.home=$RUN/home` and `XDG_RUNTIME_DIR=$RUN/runtime` (where the window writes server images and Quickshell keeps its IPC sockets and logs, so the real `/run/user/<uid>` stays untouched). Reach that window with `scripts/qs.sh`: `qs.sh ipc call miharchy openUpdates`, `qs.sh list`, `qs.sh log <id>`, and `qs.sh env <command>` for any command in the same environment. The window runs the sync helper from `$HOME/.local/share/miharchy/helper`, and this machine has a real one at `~/.local/share/miharchy/helper` whose baselines live in the real home; the run home keeps a drive that syncs, backs up or restores away from both. The run home has no Omarchy theme, so the window draws its default palette; for themed captures copy a theme in first (`site/tools/README.md`, step 1). `PATH` passes through: put logging stubs for `xdg-open`, `wl-copy` and `notify-send` first on it before any drive that opens a link, copies or notifies. Text reaches `wl-copy` as arguments (`wl-copy -- <text>`), and the reader's `Y` sends the page as `wl-copy --type <mime>` with the image on stdin; a `wl-copy` stub reads stdin only on that `--type` call, so a text call never waits on an open stdin. The offscreen window is 1280×800 and does not resize.

`steps.js` is a JS array of `[delayMs, function]` pairs, run in order inside the window (`delayMs` waits before that step). Helpers available in steps (see `scripts/driver.qml.part`):
- `key("j")`, `key("Enter")`, `key("Esc")`, `key("Tab")`, `key("Backspace")`, `key(" ")` — go through `root.handleKey`, the window's one key path.
- `root.run("view.library")` — run a command id from `window/Commands.js` directly (the palette path).
- `grab("name")` → `$RUN/evidence/name.png`; `log("label", value)` → a `DRIVER label <json>` line in `$RUN/evidence/drive.log`.
- `click(item, x, y)`, `dblclick(item, x, y)`, `wheel(item, dy, x, y, mods)`, `drag(item, x1, y1, x2, y2)` — real mouse events at item-local `x, y` (default: the item's center), sent by QtTest's `TestEvent` (drive.sh adds `import QtTest` to the copy; the module ships with `qt6-declarative`, which Quickshell needs anyway). The window delivers them as a user's: the topmost enabled `MouseArea` under the point takes them, so a click on a covered item proves the cover blocks it. `dy` is in wheel units: `-120` is one notch down; `mods` is e.g. `Qt.ControlModifier`. `drag` presses, moves in ten steps and releases. `dblclick` sends press, release, press, double-click, release, as a real double click does. A ListView scrolls with an animation: log its `contentY` about 1 s after `wheel`.
- `find(from, test)` — the first visible item under `from` that `test(item)` accepts: how a step reaches a delegate, e.g. `find(libraryView, function(i) { return i.modelData && i.index === 2 && i.current !== undefined })`. A delegate outside its list's viewport still exists, but a click on it lands on whatever is drawn there; pick one in view.
- `root.v` — scratch space a step leaves for a later one (`root.v.list = ...`).
- `done()` — quit. Prefer `root.run("window.quit")` when the quit path itself matters (it flushes reader saves).

Handles (ids in `window/shell.qml`): `root` (view, connection, settingsState), `libraryView`, `browseView` (screen, src, listing, global), `mangaDetail` (open, detail, cursor), `reader` (open, reader.chapters/index/page/mode), `updatesView`, `historyView`, `settingsView`, `setupView`, `trackPanel`, `migrateView`, `downloadsView`, `syncView`, `palette`, `keyRoot` (grab target). `drive.sh` turns off both Setup jumps in the copy (the required-step jump and the one-time offer): Setup probes the *real* machine, so it would otherwise take over the window. To verify Setup itself, drive `root.run("view.setup")` and stub the commands its probe calls on PATH (see `window/tests/setup.test.js` for the stub pattern).

Text fields: the driver cannot type. Set the field's text, then send `key("Enter")` (e.g. the source search field is `browseView` → `SourceGrid.searchField`).

Read-backs: `.claude/skills/verify-miharchy/scripts/gql.sh '<query>' ['{"var":1}']` against the scratch server, after the window exits.

## Evidence

Everything a proof needs lands in `$RUN/evidence/` and survives cleanup: `*.png` captures, `drive.log` (DRIVER lines). Also keep the GraphQL read-back output you rely on (`.claude/skills/verify-miharchy/scripts/gql.sh … | tee $RUN/evidence/readback.json`). Read the captures (the Read tool shows images) before claiming anything about the UI.

Proof standard:
- Drive the real path (keys, mouse events or command ids), not internal setters, except to fill a text field.
- Capture the action and the resulting state, not just the final screen.
- Check the side effect on the server (read state, library flag, categories, settings, meta), not only what is drawn.
- For sync: check the files written to the sync folder and the baselines in `$RUN/home/.local/share/miharchy/sync`.
- `grabToImage` of `keyRoot` omits the window's own color, so the driver puts a `theme.background` fill under `keyRoot` (`vBackground` in `driver.qml.part`); captures show the background the window draws.
- `grab()` captures after the step returns, so a key or click later in the same step shows in the capture. End the step with the `grab`, and quit (`done()`, `window.quit`) in a later step: a quit in the same step exits before the file is written.

## Cleanup

```sh
.claude/skills/verify-miharchy/scripts/server.sh stop      # stops java + JCEF helpers of this run, closes the port, deletes $RUN/server, server.json and port
.claude/skills/verify-miharchy/scripts/server.sh clean     # removes the window copy and helper home, when done
```
Evidence in `$RUN/evidence/` stays. Run `stop` after every failed attempt too, so ports and processes don't pile up. A SIGSTOPped server (hang tests) needs `kill -CONT` before `stop`.

## Features

See `features/README.md` for the map of user-facing features and how to drive each.
