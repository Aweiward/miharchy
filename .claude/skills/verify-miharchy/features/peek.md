# Peek

A peek (`GLOSSARY.md`) is the window on Hyprland's special workspace `miharchy`, shown over the current workspace. The peek key (`SUPER + M`, Setup step "Peek key") runs `window/miharchy peek`: a window already on `special:miharchy` only toggles that workspace; a window on a normal workspace gets IPC `peek` and focus, and stays where it is; with no window the launcher starts one with `MIHARCHY_PEEK=1`, moves it to `special:miharchy` and shows it. Miharchy stores no peek state.

## Sub-features
- The resume rule (`shell.qml` `peek()`): `History.peekTarget` takes the newest of the 20 newest History entries whose next chapter `Library.continueChapter` finds (the manga's chapter filters, sort and excluded scanlators, and Downloaded only) and opens it through `openChapter`, so the reader shows with Updates behind it (`root.view` is `"updates"`). Entries hidden on History never count (`history.md`).
- No target: the Library opens with its search field. A failed reply shows as the Library error.
- `MIHARCHY_OPEN_CHAPTER` wins over `MIHARCHY_PEEK` when both are set. A peek window makes no one-time Setup offer (`Setup.offersOnStart`), and `Q` comes back as a normal window (`restart.md`).

## How to get to it (user POV)
Press `SUPER + M` on any workspace; press it again, or switch workspaces, to hide it.

## Driving it with drive.sh
`drive.sh` never runs the launcher. Start the window as the launcher's cold start does, with `MIHARCHY_PEEK=1` in front of `drive.sh`. History needs an opened chapter: `updateChapter(input: {id, patch: {lastPageRead: 2}})` (after `fetchChapterPages`) on the first unread chapter in reading order (lowest `sourceOrder` by the default sort) of a library manga makes that manga the newest entry, and that chapter its next one.
```sh
MIHARCHY_PEEK=1 .claude/skills/verify-miharchy/scripts/drive.sh steps.js 40
```
```js
[
  [7000, function() { log("peek", [root.view, reader.open, reader.open ? [reader.reader.chapters[reader.reader.index].id, reader.reader.page] : null]); grab("peek-reader") }],
  [500, function() { root.run("window.quit") }]
]
```
Proof: `peek` logs `["updates", true, [<the chapter>, 2]]`: the reader opened the newest History manga's next chapter at its `lastPageRead`.

The resume path on a running window: start a drive without the variable and, while it runs, send `XDG_RUNTIME_DIR=$RUN/runtime quickshell ipc -p $RUN/app/window call miharchy peek` from the shell (the launcher's call); a later step logs the same target.

The launcher's Hyprland side (toggle, move, focus, the 3 s wait, the `peek-starting` marker) needs a compositor. Never run `window/miharchy peek` from a verify run; `node --test window/tests/launcher.test.js` covers it with stub `quickshell` and `hyprctl`.
