# Peek

A peek (`GLOSSARY.md`) is the window on Hyprland's special workspace `miharchy`, shown over the current workspace. The peek key (`SUPER + M`, Setup step "Peek key") runs `window/miharchy peek`: a window already on `special:miharchy` only toggles that workspace; a window on a normal workspace gets IPC `peek` and focus, and stays where it is; with no window the launcher starts one with `MIHARCHY_PEEK=1`, moves it to `special:miharchy` and shows it. Miharchy stores no peek state.

## Sub-features
- The resume rule (`shell.qml` `peek()`): the head of Up next (`UpNext.list`, rules in `docs/agents/window.md`) opens through `openChapter`, so the reader shows with Updates behind it (`root.view` is `"updates"`). A manga hidden on History counts as not started (`history.md`).
- The next key (`SUPER + SHIFT + M`, `window/miharchy peek-next`, IPC `peekNext`, cold start `MIHARCHY_PEEK=next`): always shows the peek and opens `UpNext.after`, the manga after the reader's in the order Up next had at the run's first press (`root.upNextOrder`, memory only), wrapping from the last to the head. With the reader closed it opens the second manga. Opening a chapter writes `lastReadAt` and moves that manga to the head of a fresh Up next, which is why the window holds the order.
- No target: the Library opens with its search field. A failed reply shows as the Library error.
- Catch-up (`GLOSSARY.md`, Settings row `catchUp`): after that many chapters of one manga read on past, the reader stops on the transition page with "Caught up on N chapters" and the next manga in Up next (`reader.upNext`: the manga the next key would open, `UpNext.after` over `root.upNextOrder`). A turn on stays; `c` reads on and lifts the stop for this reader; `n` runs the next key (`peek(true)`). Every peek open, the next key included, starts the count again. A reader opened any other way (`MIHARCHY_OPEN_CHAPTER`, Updates, History, Library) never stops. Rules in `docs/agents/window.md`.
- Peek-open (`window/miharchy peek-open <mangaId> <chapterId>`, IPC `peekOpen`, cold start `MIHARCHY_PEEK="<mangaId> <chapterId>"`): the popup's Up next rows (`plugin.md`). It shows the peek as the next key does and opens that chapter through the peek path, so Catch-up counts from 0, and it empties `root.upNextOrder`, so the next key starts a new run from that manga.
- `MIHARCHY_OPEN_CHAPTER` wins over `MIHARCHY_PEEK` when both are set. A peek window makes no one-time Setup offer (`Setup.offersOnStart`), and `Q` comes back as a normal window (`restart.md`).

## How to get to it (user POV)
Press `SUPER + M` on any workspace; press it again, or switch workspaces, to hide it. Press `SUPER + SHIFT + M` to show it on the next manga in Up next. In the mark's popup, Enter or a click on an Up next row shows it on that row's chapter.

## Driving it with drive.sh
`drive.sh` never runs the launcher. Start the window as the launcher's cold start does, with `MIHARCHY_PEEK=1` in front of `drive.sh`. `updateChapter(input: {id, patch: {lastPageRead: 2}})` (after `fetchChapterPages`) on the first unread chapter in reading order (lowest `sourceOrder` by the default sort) of a library manga puts it in tier 1 with that chapter next. To prove the tiers beat History order, then mark the first chapter of a second manga read with `{lastPageRead: 3, isRead: true}`: that manga is the newest History entry but in tier 2, and the peek still opens the first one.
```sh
MIHARCHY_PEEK=1 .claude/skills/verify-miharchy/scripts/drive.sh steps.js 40
```
```js
[
  [7000, function() { log("peek", [root.view, reader.open, reader.open ? [reader.reader.chapters[reader.reader.index].id, reader.reader.page] : null]); grab("peek-reader") }],
  [500, function() { root.run("window.quit") }]
]
```
Proof: `peek` logs `["updates", true, [<the chapter>, 2]]`: the reader opened the head of Up next at its `lastPageRead`. With every chapter read, the same drive logs `root.view` `"library"` and `libraryView.editing` true.

Catch-up: seed `--library 2`, pick a manga with 3 chapters as the head (`lastPageRead: 1` on its first chapter puts it in tier 1 of the rules, partly read), mark the first chapter of the other manga read, and set `miharchy.catchUp` to "2". `End` is not a driver key; `root.run("reader.last")` then `key(" ")` reads a chapter to its end and onto the transition page, and `key(" ")` again reads on. Give each chapter about 7 s to load. Reset the chapters with `updateChapters(input: {ids, patch: {isRead: false, lastPageRead: 0}})` between drives.
```js
[
  [9000, function() { log("start", [reader.reader.mangaId, reader.reader.chapters[reader.reader.index].id, root.settingsState.values.catchUp]); root.run("reader.last") }],
  [1000, function() { key(" ") }],
  [800, function() { key(" ") }],
  [7000, function() { root.run("reader.last") }],
  [1000, function() { key(" ") }],
  [4000, function() { log("stop", [reader.reader.chapters[reader.reader.index].id, reader.caughtUp, reader.upNext]); grab("caught-up") }],
  [300, function() { key(" ") }],
  [800, function() { log("stays", [reader.reader.chapters[reader.reader.index].id, reader.caughtUp]); key("c") }],
  [7000, function() { log("after-c", [reader.reader.chapters[reader.reader.index].id, reader.reader.lifted]); root.run("window.quit") }]
]
```
Proof: `stop` logs the second chapter, `2` and `{ target: { mangaId, chapterId }, title }`; `stays` the same chapter and `2`; `after-c` the third chapter and `true`. Send `key("n")` on the stop instead and log `reader.reader.mangaId`, `peek` and `finished`: the manga `stop` named, `true`, `0`; a `root.peek(true)` step at the stop (what IPC `peekNext` runs) opens the same manga, and a `root.peek(true)` after one chapter of a fresh peek logs `finished` 0 in the new reader. With `MIHARCHY_OPEN_CHAPTER="<mangaId> <chapterId>"` in place of `MIHARCHY_PEEK=1`, the same reading logs `reader.caughtUp` 0 and reads on to the third chapter. In RTL (the default reading mode) `l` reads back, so it leaves the stop.

The resume path on a running window: start a drive without the variable and, while it runs, send `.claude/skills/verify-miharchy/scripts/qs.sh ipc call miharchy peek` from the shell (the launcher's call); a later step logs the same target.

The next key: seed three library manga, fetch their chapters, and give the first chapter of each `lastPageRead: 2` (after `fetchChapterPages`), a few seconds apart, so all three sit in tier 1 by `lastReadAt`. Start a drive without the variable, with steps that log `[root.view, reader.open, [reader.reader.mangaId, <chapter id>]]` and `grab` at 11 s and every 6 s after. From the shell, while it runs, send `qs.sh ipc call miharchy peek` at about 8 s and `qs.sh ipc call miharchy peekNext` at 14, 20 and 26 s (a small `sleep` script started right after the backgrounded `drive.sh`). Proof: the logs walk head, second, last, head, e.g. `[2,4]`, `[1,1]`, `[3,7]`, `[2,4]`, while a `lastReadAt` read-back shows each open moved its manga to the newest. A cold start with `MIHARCHY_PEEK=next` in front of `drive.sh` logs the second manga of Up next.

Peek-open: seed `--library 3`, fetch the chapters, put manga 1 in tier 1 (`lastPageRead: 2` on its first chapter) and mark the first chapter of manga 2 read. Start a drive without the variable; from the shell send `qs.sh ipc call miharchy peek` at about 7 s and `qs.sh ipc call miharchy peekOpen <manga 2> <its next chapter>` at about 24 s, and `peekNext` at about 33 s. In between, `root.run("reader.last")`, `key(" ")`, `key(" ")` reads manga 1 on one chapter. Log `[reader.reader.mangaId, <chapter id>, reader.reader.peek, reader.reader.finished, root.upNextOrder]` after each. Proof: after the read-on `finished` is 1; after `peekOpen` the reader shows that chapter with `peek` true, `finished` 0 and `upNextOrder` `[]`; after `peekNext` the order is rebuilt with manga 2 at its head. A cold start with `MIHARCHY_PEEK="<mangaId> <chapterId>"` in front of `drive.sh` logs that chapter, `peek` true, `finished` 0, even for a manga outside Up next. The popup itself never runs under `drive.sh`; `plugin/tests/mark.test.js` covers its rows, and its payload can be sent with `gql.sh` (`Mark.upNextPayload()` loaded through `window/tests/load.js`) to check the rows against a real reply.

The launcher's Hyprland side (toggle, move, focus, the 3 s wait, the `peek-starting` marker, `peek-next`'s and `peek-open`'s show-only toggle) needs a compositor. Never run `window/miharchy peek`, `peek-next` or `peek-open` from a verify run; `node --test window/tests/launcher.test.js` covers it with stub `quickshell` and `hyprctl`.
