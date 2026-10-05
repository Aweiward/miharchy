---
name: verify-miharchy
description: Drive Miharchy's real window (Quickshell/QML) offscreen against a throwaway Suwayomi-Server, and read results back over GraphQL, to prove a window or sync change works. Use after changing anything in window/, sync/ or server/, before claiming a feature works, or to reproduce a bug. Never touches the user's real server (port 4590), desktop, or ~/.config/omarchy.
---

# verify-miharchy

Miharchy's user surface is the window (`window/`, Quickshell QML), backed by Suwayomi-Server over GraphQL, plus the sync helper CLI (`sync/`) and a bar plugin (`plugin/`). Proof means: drive the **real** window code through the same command path keys use (`root.handleKey`, command ids), then confirm the **server state** changed (GraphQL read-back), with captures of what the window showed.

Hard rules, from incidents on this project:
- Never use the user's server: port 4590, `~/.config/miharchy/server.json`, `~/.local/share/miharchy`. Every run gets its own server on its own port (`MIHARCHY_VERIFY_PORT`, default 4591) and its own run dir.
- Never open windows on the desktop or send keystrokes to it (a safety check blocks it; the user is working). Everything runs with `QT_QPA_PLATFORM=offscreen`.
- Never kill by process name. `pkill -f <pattern>` matches its own command line and has killed the shell running it here. `server.sh stop` kills by PID file and by this run's server dir only.
- Never edit `~/.config/omarchy/` or restart the live shell.

All scripts live in `scripts/` and read `scripts/env.sh`: `MIHARCHY_VERIFY_DIR` (run dir, default `${TMPDIR:-/tmp}/miharchy-verify/run`) and `MIHARCHY_VERIFY_PORT`. Use a fresh run dir **and port** per task, e.g. `export MIHARCHY_VERIFY_DIR=$TMPDIR/miharchy-verify/<task>-$(date +%s) MIHARCHY_VERIFY_PORT=46xx` (inside Claude Code, prefer the session scratchpad over /tmp). Agents running in parallel must never share a run dir: `stop` kills whatever server that dir recorded, and the window copy in `$RUN/app` would be overwritten. `start` refuses a dir whose recorded server is still running.

## Launch

```sh
S=.claude/skills/verify-miharchy/scripts
$S/server.sh start                      # ~30–60 s; prints "ready: Suwayomi v… on 127.0.0.1:4591"
$S/seed.sh --library 2                  # Keiyoushi repo + MangaDex, 2 popular manga in the library
$S/seed.sh eu.kanade.tachiyomi.extension.en.weebcentral   # more extensions by pkgName
```

The server is `/usr/bin/suwayomi-server` (AUR `suwayomi-server-bin`) with `-Dsuwayomi.tachidesk.config.server.rootDir=$RUN/server`, `basic_auth` with random credentials written to `$RUN/server.json`. Ready = `aboutServer{version}` answers with those credentials. A fresh server downloads JCEF (~250 MB) on first start into its root dir; that is normal.

The sync helper builds once per checkout: `(cd sync && ./gradlew installDist)` → `sync/build/install/miharchy-sync/bin/miharchy-sync`. Run it against the scratch server with `JAVA_OPTS=-Duser.home=$RUN/home MIHARCHY_SERVER_JSON=$RUN/server.json`.

## Doctor

```sh
$S/server.sh doctor    # "ok: pid N owns 4591, Suwayomi v…, unauthenticated request -> 401"
```
Run it first whenever anything looks off. It fails if the PID file is missing, the process is dead, another process owns the port, or auth is not enforced.

## Drive

```sh
$S/drive.sh steps.js 90     # copies window/ into $RUN/app, appends the driver, runs it offscreen for ≤ 90 s
```
`steps.js` is a JS array of `[delayMs, function]` pairs, run in order inside the window (`delayMs` waits before that step). Helpers available in steps (see `scripts/driver.qml.part`):
- `key("j")`, `key("Enter")`, `key("Esc")`, `key("Tab")`, `key("Backspace")`, `key(" ")` — go through `root.handleKey`, the window's one key path.
- `root.run("view.library")` — run a command id from `window/Commands.js` directly (the palette path).
- `grab("name")` → `$RUN/evidence/name.png`; `log("label", value)` → a `DRIVER label <json>` line in `$RUN/evidence/drive.log`.
- `done()` — quit. Prefer `root.run("window.quit")` when the quit path itself matters (it flushes reader saves).

Handles (ids in `window/shell.qml`): `root` (view, connection, settingsState), `libraryView`, `browseView` (screen, src, listing, global), `mangaDetail` (open, detail, cursor), `reader` (open, reader.chapters/index/page/mode), `updatesView`, `historyView`, `settingsView`, `setupView`, `trackPanel`, `migrateView`, `downloadsView`, `syncView`, `palette`, `keyRoot` (grab target). `drive.sh` turns off both Setup jumps in the copy (the required-step jump and the one-time offer): Setup probes the *real* machine, so it would otherwise take over the window. To verify Setup itself, drive `root.run("view.setup")` and stub the commands its probe calls on PATH (see `window/tests/setup.test.js` for the stub pattern).

Text fields: the driver cannot type. Set the field's text, then send `key("Enter")` (e.g. the source search field is `browseView` → `SourceGrid.searchField`).

Read-backs: `$S/gql.sh '<query>' ['{"var":1}']` against the scratch server, after the window exits.

## Evidence

Everything a proof needs lands in `$RUN/evidence/` and survives cleanup: `*.png` captures, `drive.log` (DRIVER lines). Also keep the GraphQL read-back output you rely on (`$S/gql.sh … | tee $RUN/evidence/readback.json`). Read the captures (the Read tool shows images) before claiming anything about the UI.

Proof standard:
- Drive the real path (keys or command ids), not internal setters, except to fill a text field.
- Capture the action and the resulting state, not just the final screen.
- Check the side effect on the server (read state, library flag, categories, settings, meta), not only what is drawn.
- For sync: check the files written to the sync folder and the baselines in `$RUN/home/.local/share/miharchy/sync`.
- `grabToImage` of `keyRoot` omits the window background color; a black or white background in captures is expected.

## Cleanup

```sh
$S/server.sh stop      # stops java + JCEF helpers of this run, closes the port, deletes $RUN/server and server.json
rm -rf "$MIHARCHY_VERIFY_DIR/app" "$MIHARCHY_VERIFY_DIR/home"   # the window copy and helper home, when done
```
Evidence in `$RUN/evidence/` stays. Run `stop` after every failed attempt too, so ports and processes don't pile up. A SIGSTOPped server (hang tests) needs `kill -CONT` before `stop`.

## Features

See `features/README.md` for the map of user-facing features and how to drive each.
