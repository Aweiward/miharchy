# Restart onto new code

After `omarchy plugin update` (a `git merge --ff-only` in the clone) an open window keeps the code it loaded: `settings.watchFiles: false` turns off Quickshell's reload in place. Every 30 s `shell.qml` runs `Restart.fingerprintCommand` (sha256 of `window/*.qml window/*.js`, read only) and keeps the result in `root.code` (`{ start, changed }`, `Restart.check`). While `changed`, the status bar's `codeHint` shows "new version   Q restart".

`Q` (command `window.restart`, global, also "Restart the window" in the palette and a click on the hint part) sets `root.restarting`, starts `Restart.relaunchCommand(Quickshell.processId, <window>/miharchy)` with `Quickshell.execDetached`, and runs `reader.quit()`. The detached sh waits until the old pid is gone (`quickshell -n` refuses while it runs), unsets `MIHARCHY_OPEN_CHAPTER`, `MIHARCHY_OPEN_VIEW` and `MIHARCHY_PEEK` (a peek comes back as a normal window), and execs the launcher.

## How to get to it (user POV)
Leave the window open, run `omarchy plugin update miharchy`, wait up to 30 s, press `Q` or click "Q restart".

## Driving it
`drive.sh` copies `window/` and cannot update it, so drive from a scratch git clone instead:
1. `git clone --bare -b <branch> <repo> origin.git`, then two clones of it: `clone` (the window runs here) and `upstream`.
2. Apply `drive.sh`'s edits to `clone/window` (Setup jumps off, `import QtTest`, the driver with steps one) and push. In `upstream`, pull, restore `shell.qml` and `SetupView.qml` from `HEAD~1`, apply the driver with steps two, and also change a few QML components (`HintBar.qml`, `LibraryView.qml`): an update that touches only `shell.qml` or JS would not have reloaded even with the watch on. Push.
3. Start `clone/window/miharchy` (the launcher, so `quickshell -n` and `quickshell list` see the same path) offscreen under `timeout`, with the environment `drive.sh` gives the window (`HOME=$RUN/home`, `XDG_RUNTIME_DIR=$RUN/runtime`, `JAVA_OPTS`, `MIHARCHY_SERVER_JSON`, `MIHARCHY_SERVER_ROOT`, `MIHARCHY_SERVER_TMPDIR`, `QT_QPA_PLATFORM=offscreen`) and a logging `hyprctl` stub first on `PATH` that prints `[]`; the launcher's `focus()` must never reach the compositor.
4. About 10 s in, `git -C clone pull --ff-only`. Steps one wait past the 30 s check, log `root.code` and `codeHint.text`, grab, then `click()` the `Q restart` part (`find(codeHint, ...)`) or, in the reader, turn a page and `key("Q")` within 1 s.
5. Steps two (the new code) log `Quickshell.processId`, `Quickshell.env("QT_QPA_PLATFORM")`, `root.view` and `root.code`, grab, and `done()`.

The new window's stdout does not reach the first one's log: read it with `XDG_RUNTIME_DIR=$RUN/runtime quickshell log $RUN/runtime/quickshell/by-id/<id>/log.qslog` (pick ids newer than the run). Poll `quickshell list -j -p clone/window` (with the same `XDG_RUNTIME_DIR`; it prints plain text, not JSON, when nothing runs) every 0.5 s during the run: the pids go old, then new, never two at once. Read back the reader save: `chapter(id){ lastPageRead lastReadAt }`. `git -C clone status --porcelain` stays empty, since the window writes nothing in the clone.
