---
name: verify-miharchy
description: Drive Miharchy's real window (Quickshell/QML) offscreen against a throwaway miharchy-core, and read results back through core's routes, to prove a window, plugin or core change works. Use after changing anything in window/, plugin/, core/ or sync/, before claiming a feature works, or to reproduce a bug. Never touches the user's real servers (ports 4590 and 4591), desktop, or ~/.config/omarchy.
---

# verify-miharchy

Miharchy's user surface is the window (`window/`, Quickshell QML), backed by miharchy-core (`core/`) over its routes, plus a bar plugin (`plugin/`). Proof means: drive the **real** window code through the same command path keys use (`root.handleKey`, command ids), then confirm **core's state** changed (a `core.sh api` read-back), with captures of what the window showed.

Hard rules, from incidents on this project:
- Never use the user's core: port 4591, `~/.config/miharchy/core.json`, `~/.local/share/miharchy`. Never use the user's old Suwayomi either: port 4590, `~/.config/miharchy/server.json`. Every run gets its own core on its own port and its own run dir.
- Never open windows on the desktop or send keystrokes to it (a safety check blocks it; the user is working). Everything runs with `QT_QPA_PLATFORM=offscreen`.
- Never kill by process name. `pkill -f <pattern>` matches its own command line and has killed the shell running it here. `core.sh stop` kills by PID file only; `server.sh stop` kills by PID file and by this run's server dir only.
- Never edit `~/.config/omarchy/` or restart the live shell.
- Never print a process's whole environment (`/proc/<pid>/environ`, `env`): it holds the session's tokens. Check one variable, e.g. `tr '\0' '\n' < /proc/<pid>/environ | grep '^XDG_RUNTIME_DIR='`.

Run each script as one plain command from the worktree root, e.g. `.claude/skills/verify-miharchy/scripts/core.sh start`: no `export`, no `cd`, no `VAR=...;` prefix. Shell state does not persist between Bash calls, and the scripts need none. Each script reads `scripts/env.sh`, which sets the run dir to `${TMPDIR:-/tmp}/miharchy-verify/<worktree folder name>`, so every worktree gets its own run. `core.sh start` picks a free port (never 4590 or 4591) and keeps it in `$RUN/core/port`; every later `core.sh` call of that run reads it. `core.sh start` prints `config <RUN>/core/core.json`: use that literal `<RUN>` wherever this skill says `$RUN`.

Runs must never share a run dir: `stop` kills whatever core that dir recorded, and the window copy in `$RUN/app` would be overwritten. Parallel agents in separate worktrees get separate dirs on their own. Two runs in the **same** worktree need `MIHARCHY_VERIFY_DIR=<another dir>` on every command of the second run. `core.sh start` reuses a core that already runs in the dir.

## Launch

```sh
.claude/skills/verify-miharchy/scripts/core.sh start    # builds core/ if needed; "ready: miharchy-core on 127.0.0.1:<port> (pid N), config <RUN>/core/core.json"
.claude/skills/verify-miharchy/scripts/core.sh seed     # Keiyoushi repo + MangaDex, so Browse has a source
```

`core.sh stop` then `core.sh start` restarts the same core: same port, secret and library. Use it to prove the window reconnects after a core restart. `core.sh wipe` deletes `$RUN/core`, so the next `start` is a fresh core.

## miharchy-core

The window and the mark run on miharchy-core only (#373). `window_env` points the window at this run's `$RUN/core/core.json`, so no other variable is needed.

```
.claude/skills/verify-miharchy/scripts/core.sh api library.list '{}'   # any route; the secret never goes on the command line
printf %s "$BODY" | .claude/skills/verify-miharchy/scripts/core.sh api tracker.login -   # a body with a password, token or callback: on stdin
.claude/skills/verify-miharchy/scripts/core.sh stop     # keeps $RUN/core; start again resumes the same data
```

`core.sh api <route> '<json>'` sends `POST /api/<route>` with the body and prints the reply. The route names and their fields are in `core/README.md` and in core's Kotlin source (`core/server/src/main/kotlin/miharchy/core/`, the `"<route>" to {` lines). A refused body answers `{"error":{"kind":…,"message":…}}`. Lists are plain arrays: `library.list` answers `mangas`, `chapter.list` answers `chapters`. `meta.get` matches exact keys only: to read every key with a prefix, ask `meta.get '{"scope":"global"}'` and filter with `jq`.

`seed` leaves the library empty. To get a library with Updates rows, an Up next head and a reading history, run these after `seed` (MangaDex's search creates manga rows):

```
core.sh api source.list '{}'                                         # MangaDex (EN)'s id
core.sh api source.search '{"source":"<id>","page":1,"query":"Berserk"}'
core.sh api manga.update '{"ids":[2,3],"inLibrary":true}'            # add first ...
# wait 2 s: a fetch in the same second as the add makes no Updates rows
core.sh api manga.refresh '{"id":2}'                                 # ... then fetch: chapters fetched after the add are Updates rows
core.sh api chapter.update '{"ids":[<ch 1>],"isRead":true,"lastPageRead":5}'   # a read time puts the manga in Up next and History
```

Take ids from the replies: the search's order changes with what the source lists today. A `manga.refresh` can answer "The source returned no chapters"; pick another manga then. Chapter ids come from `chapter.list '{"mangaIds":[<id>]}'`.

Some state has no route. Write it into `$RUN/core/data/core.db` with `sqlite3` while core runs:
- A read time in the past: `chapter.update` with `lastPageRead` first (it makes the `history` row), then `UPDATE history SET read_at = CAST(strftime('%s', '2026-11-20 21:00', 'utc') AS INTEGER) * 1000 WHERE chapter_id = <id>` (local time in, milliseconds stored).
- A track record (no tracker login): `INSERT INTO manga_track (manga_id, tracker_id, remote_id, remote_url, title, last_chapter_read, total_chapters, status, score) VALUES (<manga>, 2, 101010, 'https://anilist.co/manga/101010', '<title>', 3, 0, 1, 0)`. Tracker 2 is AniList; `tracker.list` lists the ids.
- Old upload or fetch times: `chapter.remote_date_upload`, `manga.state_chapter_last_update` (milliseconds).

Core never uses 4590 or 4591, and keeps its data under `$RUN/core`: `data/core.db`, `data/covers` (its only cache), `data/downloads`, `data/sync`, `data/backups`, and its output in `core.log`. Core logs no requests; to see what the window sends, use the logging proxy (Live updates). Rebuild with `./gradlew :server:installDist` in `core/` after a core change: `start` builds only when no build exists. Core has no local source yet (#374): `source.list` has no id `"0"`, and `localSourcePath` is stored only. A drive greps `$RUN/window.log` for `miharchy: refused`, which `Session.send` logs for a payload with no core route; it must stay 0.

## Move from Suwayomi

Setup's move (`move.start`, `core/README.md`) reads a Suwayomi install once. It is the only part of Miharchy that still talks to Suwayomi. The scratch Suwayomi exists only to give the move a source: `server.sh`, `seed.sh` and `gql.sh` start, seed and read it. Only the move's recipes (`migrate.md`, `library-check.md`) and `site/tools`' showcase run use them; `server.sh clean` serves every run.

```sh
.claude/skills/verify-miharchy/scripts/server.sh start     # ~30–60 s; prints "ready: Suwayomi v… on 127.0.0.1:<port> (pid N), run dir <RUN>"
.claude/skills/verify-miharchy/scripts/seed.sh --library 2 # Keiyoushi repo + MangaDex, 2 popular manga in the library
.claude/skills/verify-miharchy/scripts/seed.sh eu.kanade.tachiyomi.extension.en.weebcentral   # more extensions by pkgName
.claude/skills/verify-miharchy/scripts/gql.sh '{ mangas(condition:{inLibrary:true}){ totalCount } }'
.claude/skills/verify-miharchy/scripts/core.sh api move.start '{"serverConfig":"<RUN>/server.json","serverRoot":"<RUN>/server"}'
.claude/skills/verify-miharchy/scripts/core.sh api move.status '{}'   # until "state" is "done"
```

The server is `/usr/bin/suwayomi-server` (AUR `suwayomi-server-bin`) with `-Dsuwayomi.tachidesk.config.server.rootDir=$RUN/server` and `-Djava.io.tmpdir=$RUN/server/tmp` (the default `/tmp/Tachidesk` is the user's server's too), and `ui_login` with random credentials written to `$RUN/server.json`. `server.sh start` keeps its port in `$RUN/port`; `MIHARCHY_VERIFY_PORT` forces one. It refuses a dir whose recorded server still runs. It returns once a login works: the server runs detached, with its output in `$RUN/server.log`. A fresh server downloads JCEF (~250 MB) on first start into its root dir; that is normal. `server.sh stop` then `start` wipes the Suwayomi library; `server.sh restart` keeps a seeded one.

## Live updates

The download queue and Updates follow core's `downloads` and `updates` topics over a WebSocket to `/api/live` (`window/LiveSocket.qml`), which needs `qt6-websockets`. Without the module the window still runs, with nothing live, and logs "Live updates need qt6-websockets". When it is not installed, extract the Arch package into a scratch dir (`pacman -Sp qt6-websockets` gives the URL; check the `.sig` with `pacman-key --verify`) and run `drive.sh` with `QML_IMPORT_PATH=<dir>/usr/lib/qt6/qml LD_LIBRARY_PATH=<dir>/usr/lib` in front: one of the two places a `VAR=...` prefix belongs; the other is a start target (`MIHARCHY_PEEK=1`, `MIHARCHY_OPEN_VIEW=updates`, `MIHARCHY_OPEN_CHAPTER="<mangaId> <chapterId>"`), which `drive.sh` passes through to the window as the launcher would set it. Each drive overwrites `$RUN/evidence/drive.log`, so copy it to its own name before the next drive. To show that nothing polls, or to see which routes the window sends, point the drive at a logging proxy: write a copy of `$RUN/core/core.json` whose `url` is the proxy's port over `$RUN/core/core.json` (`core.sh` uses `$RUN/core/port`, not the url), and log each request path and WebSocket upgrade. Never print the secret the proxy forwards. Put the original `core.json` back before any `core.sh start`: core takes its port from that url and refuses to start when it differs from `$RUN/core/port`. Run `core.sh stop` and `core.sh start` while a drive runs in the background to prove the reconnect. A library update only shows progress when the seeded manga pass the skip filters: `core.sh api settings.set '{"settings":{"excludeUnreadChapters":false,"excludeNotStarted":false,"excludeCompleted":false}}'`.

## Doctor

```sh
.claude/skills/verify-miharchy/scripts/core.sh api health '{}'   # {"ok":true,"schema":N}
```
Run it first whenever the scratch core looks off. It fails when core is down or the secret in `$RUN/core/core.json` is not its own. `core.sh start` answers "already up on …" when this run's core still listens. For the move's scratch Suwayomi, `server.sh doctor` prints "ok: pid N owns <port>, Suwayomi v…, request without a token -> Unauthorized, run dir <RUN>", and fails if the PID file is missing, the process is dead, another process owns the port, the login fails, or auth is not enforced.

## Drive

```sh
.claude/skills/verify-miharchy/scripts/drive.sh steps.js 90     # copies window/ (and sync/ and core/ without build output, for Setup) into $RUN/app, appends the driver, runs it offscreen for ≤ 90 s
```
`drive.sh` patches the copy with `scripts/patch-window.py` (both Setup jumps off, `import QtTest`, the driver) and runs it through `window_env` in `env.sh`: `HOME=$RUN/home`, `JAVA_OPTS=-Duser.home=$RUN/home` and `XDG_RUNTIME_DIR=$RUN/runtime` (where the window writes core's images and Quickshell keeps its IPC sockets and logs, so the real `/run/user/<uid>` stays untouched). Reach that window with `scripts/qs.sh`: `qs.sh ipc call miharchy openUpdates`, `qs.sh list`, `qs.sh log <id>`, and `qs.sh env <command>` for any command in the same environment. The run home keeps what the window writes itself (saved pages, the reading card, Setup's probes) away from the real home. The run home has no Omarchy theme, so the window draws its default palette; for themed captures copy a theme in first: `mkdir -p $RUN/home/.local/state/omarchy/current && cp -r ${OMARCHY_PATH:-$HOME/.local/share/omarchy}/themes/tokyo-night $RUN/home/.local/state/omarchy/current/theme`. Do not source `site/tools/env.sh` in a verify run: it points `MIHARCHY_VERIFY_DIR` at the showcase run. `PATH` passes through: put logging stubs for `xdg-open`, `wl-copy` and `notify-send` first on it before any drive that opens a link, copies or notifies. Text reaches `wl-copy` as arguments (`wl-copy -- <text>`), and the reader's `Y` sends the page as `wl-copy --type <mime>` with the image on stdin; a `wl-copy` stub reads stdin only on that `--type` call, so a text call never waits on an open stdin. The offscreen window is 1280×800 and does not resize.

`steps.js` is a JS array of `[delayMs, function]` pairs, run in order inside the window (`delayMs` waits before that step). Helpers available in steps (see `scripts/driver.qml.part`):
- `key("j")`, `key("Enter")`, `key("Esc")`, `key("Tab")`, `key("Backspace")`, `key(" ")` — go through `root.handleKey`, the window's one key path.
- `root.run("view.library")` — run a command id from `window/Commands.js` directly (the palette path).
- `grab("name")` → `$RUN/evidence/name.png`; `log("label", value)` → a `DRIVER label <json>` line in `$RUN/evidence/drive.log`.
- `click(item, x, y)`, `dblclick(item, x, y)`, `wheel(item, dy, x, y, mods)`, `drag(item, x1, y1, x2, y2)` — real mouse events at item-local `x, y` (default: the item's center), sent by QtTest's `TestEvent` (drive.sh adds `import QtTest` to the copy; the module ships with `qt6-declarative`, which Quickshell needs anyway). The window delivers them as a user's: the topmost enabled `MouseArea` under the point takes them, so a click on a covered item proves the cover blocks it. `dy` is in wheel units: `-120` is one notch down; `mods` is e.g. `Qt.ControlModifier`. `drag` presses, moves in ten steps and releases. `dblclick` sends press, release, press, double-click, release, as a real double click does. A ListView scrolls with an animation: log its `contentY` about 1 s after `wheel`.
- `find(from, test)` — the first visible item under `from` that `test(item)` accepts: how a step reaches a delegate, e.g. `find(libraryView, function(i) { return i.modelData && i.index === 2 && i.current !== undefined })`. A delegate outside its list's viewport still exists, but a click on it lands on whatever is drawn there; pick one in view.
- `root.v` — scratch space a step leaves for a later one (`root.v.list = ...`).
- `done()` — quit. Prefer `root.run("window.quit")` when the quit path itself matters (it flushes reader saves).

Handles (ids in `window/shell.qml`): `root` (view, connection, config, settingsState), `libraryView` (the Library view: `shown`, `manga`, `cursor`, `query`, `selected`, `armed`, `scope`, `hint`; its whole state is `libraryView.library`), `browseView` (screen, src, listing, global), `mangaDetail` (open, detail, cursor), `reader` (open, reader.chapters/index/page/mode), `updatesView`, `historyView`, `settingsView`, `setupView`, `trackPanel`, `migrateView`, `downloadsView`, `syncView`, `palette`, `extensionsView`, `restoreView`, `checkView` (the library check), `nextChapters` (the next chapters menu), `readingCard`, `hintBar`, `codeHint`, `keyRoot` (grab target). `drive.sh` turns off both Setup jumps in the copy (the required-step jump and the one-time offer): Setup probes the *real* machine, so it would otherwise take over the window. To verify Setup itself, drive `root.run("view.setup")` and stub the commands its probe calls on PATH (see `window/tests/setup.test.js` for the stub pattern).

Text fields: the driver cannot type. Set the field's text, then send `key("Enter")` (e.g. the source search field is `browseView` → `SourceGrid.searchField`).

Read-backs: `.claude/skills/verify-miharchy/scripts/core.sh api <route> '<json body>' | jq -c '<filter>'` against the scratch core, after the window exits. `gql.sh` reads the scratch Suwayomi, for a move's source only.

## Evidence

Everything a proof needs lands in `$RUN/evidence/` and survives cleanup. `drive.sh` creates it; before the first drive, `mkdir -p $RUN/evidence`. It holds `*.png` captures, `drive.log` (DRIVER lines). Also keep the read-back output you rely on (`.claude/skills/verify-miharchy/scripts/core.sh api … | tee $RUN/evidence/readback.json`). Read the captures (the Read tool shows images) before claiming anything about the UI.

Proof standard:
- Drive the real path (keys, mouse events or command ids), not internal setters, except to fill a text field.
- Capture the action and the resulting state, not just the final screen.
- Check the side effect on core (read state, library flag, categories, settings, meta), not only what is drawn.
- For sync: check the files written to the sync folder and core's baselines in `$RUN/core/data/sync`.
- `grabToImage` of `keyRoot` omits the window's own color, so the driver puts a `theme.background` fill under `keyRoot` (`vBackground` in `driver.qml.part`); captures show the background the window draws.
- `grab()` captures after the step returns, so a key or click later in the same step shows in the capture. End the step with the `grab`, and quit (`done()`, `window.quit`) in a later step: a quit in the same step exits before the file is written.

## Cleanup

```sh
.claude/skills/verify-miharchy/scripts/core.sh wipe        # stops this run's core and deletes $RUN/core
.claude/skills/verify-miharchy/scripts/server.sh clean     # removes the window copy, run home, runtime dir and restart clones, when done
.claude/skills/verify-miharchy/scripts/server.sh stop      # only after a move: stops the scratch Suwayomi, deletes $RUN/server, server.json and port
```
Evidence in `$RUN/evidence/` stays. Run `core.sh stop` (or `wipe`) after every failed attempt too, so ports and processes don't pile up. A SIGSTOPped core (hang tests) needs `kill -CONT` before `stop`.

## Features

See `features/README.md` for the map of user-facing features and how to drive each.
