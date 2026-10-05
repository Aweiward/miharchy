# Reader

The reader overlay: paged (right to left, left to right, vertical) or a strip (webtoon, continuous vertical), page preload, read state saved to the server, next/previous chapter, save on quit.

## Sub-features
- `h`/`l`/arrows turn pages (direction follows the mode). `j`/`k`/`d`/`u`/Space scroll the strip in webtoon, and a paged page taller than the view (fit width, original size); at the page's edge they turn.
- `z` cycles the page fit in paged (fit screen, fit width, fit height, original size); `+`/`=`/`-` step the webtoon width (30–100 % of the window). Both are global meta (`miharchy.pageFit`, `miharchy.webtoonWidth`), also rows in Settings. The bottom-right indicator names the fit or the width.
- Reader background (Settings row and panel row `readerTheme`, global meta `miharchy.readerTheme`): theme (the default, the Omarchy theme's background), black, gray (Mihon's `#202125`) or white. `reader.color` is it, and it shows in captures.
- Chapter transition (Mihon's `ChapterTransition`, `reader.reader.transition`): a turn past the last page (or the first) shows a page with the finished and the next chapter (or the previous and the current), "There's no next chapter" past the end, a warning when the chapter numbers skip (Mihon's `calculateChapterGap`, over the reader's list, so skipped chapters count) and one when that chapter is not downloaded while offline (`reader.offline`: no default route, checked as each chapter loads). A turn its way opens that chapter; a turn back returns to the page. Always show chapter transition (Settings and panel row, meta `miharchy.alwaysShowChapterTransition`, default on as in Mihon) off shows it only at either end, on a gap or offline. In webtoon the strip's end shows it, and scrolling up leaves it. Log `reader.reader.transition` (`dir`, `from`, `to`, `gap`, `missing`). A gap to drive: mark a middle chapter read (`updateChapter`) and turn skip read on.
- Keep the screen on (Settings and panel row, meta `miharchy.keepScreenOn`, default on): shell.qml's `idleInhibitor` (Quickshell's `IdleInhibitor` on `window`) is enabled while the reader shows and the row is on, so hypridle neither dims nor locks. Offscreen there is no Wayland surface, so a drive proves only `idleInhibitor.enabled`; never run the window on the real compositor to check the lock.
- `]`/`[` open the next/previous chapter where it was left; Home/End go to the first/last page; `g` opens a go-to-page field.
- The offline warning cannot be driven by changing the network; a drive sets `reader.offline = true` to show it (a simulated signal), and `tests/reader.test.js` pins the rule.
- `o` opens the chapter's page on the source's site with `xdg-open`; `y` copies its link with `wl-copy -- <url>` (the server's `ChapterType.realUrl`, carried by `Browse.toChapters` and `Reader.relist`). The bottom-left line says "Link copied", or that the server has no link. Prove it with stubs: put `xdg-open` and `wl-copy` scripts that append their arguments to a file first on `PATH` before `drive.sh`, never the real ones.
- Skip read, skip filtered and skip duplicate chapters (Settings rows, global meta `miharchy.skipRead`, `miharchy.skipFiltered` default on, `miharchy.skipDupe`) shape `reader.reader.chapters` as a chapter opens; the chapter opened always stays. Skip filtered uses that manga's chapter filter (manga meta `miharchy.chapterFilter*`), which the reader loads itself a moment after it opens. Set them with `setGlobalMeta`/`setMangaMeta` before the drive, then log `reader.reader.chapters` ids after a 2 s wait.
- `m` cycles the reading mode, in Mihon's order: right to left, left to right, vertical, webtoon, continuous vertical (saved per manga in meta `miharchy.readingMode`; values `paged-rtl`, `paged-ltr`, `paged-vertical`, `webtoon`, `continuous-vertical`, also the Default reading mode options). Vertical pages like left to right (`h` back, `l` on, `j`/`k` turn a page that fits) with Mihon's L click layout; continuous vertical is the webtoon strip with a 15 px gap under each page (`Reader.stripGap`, the strip's `spacing`). Everything the strip does in webtoon (`+`/`-` width, scroll, transition at its end) it does in both (`Reader.strip`, `reader.inStrip`). `f` fullscreen (real compositor only).
- `s` opens the settings panel (Mihon's reader settings sheet, `reader.panelOpen`, scope `reader-settings`): "This manga" holds the reading mode (manga meta, as `m`), "Every manga" the Settings rows in `Reader.PANEL_KEYS` (global meta, the same rows as the Settings view). `j`/`k` move, Enter or Space change a row at once, Esc, `s` or `q` close it. A skip change lists the chapters again at once (`reader.relist()`), keeping the chapter open. Rows: `reader.panelRows`, cursor `reader.panelCursor`; a row's delegate is `find(reader, function(i) { return i.modelData && i.modelData.key === "<key>" && i.current !== undefined })`.
- Saves `lastPageRead` 1 s after the last turn; marks `isRead` on the last page; quitting flushes the pending save.
- Incognito (palette "Incognito mode on or off", Settings row, global meta `miharchy.incognito`): the reader takes it as it opens (`reader.reader.incognito`) and then saves nothing (no `lastPageRead`, `isRead` or `lastReadAt`, so no history), sends no `trackProgress` and deletes nothing after reading. The status bar and the reader's bottom-left show "incognito" in the accent color. Prove it: toggle it with `root.run("mode.incognito")`, read a chapter to its end (End), `window.quit`, and read back the chapter unchanged.

## How to get to it (user POV)
Library → `Enter` on a manga → `Enter` on a chapter.

## Driving it with drive.sh
```js
[
  [4000, function() { key("Enter") }],
  [5000, function() { key("Enter") }],
  [6000, function() { var r = reader.reader; log("opened", [r.chapters[r.index].id, r.page, r.pages.length, r.mode]); key(" ") }],
  [800,  function() { var r = reader.reader; log("turned", [r.chapters[r.index].id, r.page]); grab("reader-page2"); root.run("window.quit") }]
]
```
Read back after exit (the quit at 0.8 s happens before the 1 s debounce, so this also proves save-on-quit):
`$S/gql.sh 'query($id:Int!){ chapter(id:$id){ lastPageRead isRead lastReadAt } }' '{"id":<chapter id>}'` → `lastPageRead` equals the logged page, `lastReadAt` set.

Jumps (Home/End are key codes, so call `root.handleKey`; the go-to field is `reader.pageField`, set its text then send Enter):
```js
[
  [800, function() { root.handleKey({ key: 0x01000011, text: "", modifiers: 0 }) }],     // End: last page, marks the chapter read
  [800, function() { key("g") }],
  [300, function() { reader.pageField.text = "3" }],
  [100, function() { key("Enter") }],                                                 // page 3, index 2
  [800, function() { key("]") }],                                                     // next chapter; the old one saves first
  [3000, function() { log("after", [reader.reader.chapters[reader.reader.index].id, reader.reader.page]); root.run("window.quit") }]
]
```
Fit and width: the paged Flickable is the child of `reader` with a `page` property (`reader.children`), and `page` is the slot shown: its `width`/`height` is the size shown, its `implicitWidth`/`implicitHeight` the decoded size. Log `contentY`, `atYBeginning`, `atYEnd` around `j`/Space to show scroll-before-turn. The strip is the child with `cacheBuffer`; its `width` follows `reader.webtoonWidth`. Grab in its own step, before the next key: `grab` lands a frame later, and a fit change reloads the page.

## Gotchas
- Suwayomi clamps `lastPageRead` to `pageCount` (-1 until pages are fetched); the reader fetches pages first.
- A chapter that is already read reopens at page 1 (Mihon's rule).
- End and a jump to the last page mark the chapter read, as a turn onto it does.
- `z` does nothing in webtoon and `+`/`-` nothing in paged: each changes what that mode shows.
- The default reading mode comes from meta `miharchy.defaultReadingMode`; long-strip manga open in webtoon.
