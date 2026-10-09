# Reader

The reader overlay: paged (right to left, left to right, vertical) or a strip (webtoon, continuous vertical), page preload, read state saved to the server, next/previous chapter, save on quit.

## Sub-features
- `h`/`l`/arrows turn pages (direction follows the mode); on a page wider than the view (zoomed, fit height, original size) they first pan half a view that way, as Mihon's navigate to pan (`Reader.action`'s `room`). `j`/`k`/`d`/`u`/Space scroll the strip, and a paged page taller than the view (fit width, original size); at the page's edge they turn.
- `z` cycles the page fit in paged (fit screen, fit width, fit height, original size); `+`/`=`/`-` step the webtoon width in the strip (30–100 % of the window). Both are global meta (`miharchy.pageFit`, `miharchy.webtoonWidth`), also rows in Settings. The bottom-right indicator names the fit or the width.
- Two-page spreads (Settings and panel row `dualPageView`, meta `miharchy.dualPageView`: never, the default, always, or when the window is wider than tall; Mihon's dual page view, right to left and left to right only, `Reader.dual`): the first page shows alone, then pairs; a wide page (a double page already) shows alone. The first page of a pair sits on the right in right to left. A turn moves by the spread; `reader.reader.page` is its first page, and a spread ending on the last page marks the chapter read. Split wide pages (row and meta `dualPageSplit`, off): outside spreads a wide page reads as two halves, the right first in right to left, `reader.reader.half` 0 then 1; back onto it shows the second half. Wideness is known only once a page decodes, so a page not loaded yet pairs. Set both with `setGlobalMeta` before a drive: the panel's Enter cycles from the stored value.
- Crop borders (Settings and panel rows `cropBordersPaged`, on, and `cropBordersWebtoon`, off; meta `miharchy.cropBordersPaged`, `miharchy.cropBordersWebtoon`): paged hides a page's plain margin on four sides, the strip on the left and right; a split page crops each half. Fixtures with a margin you control: the local source (`browse.md`), PNGs written into `$RUN/server/local/<manga>/<chapter>/` with PIL (a white frame, a black frame, a text-like mostly white page, art to the edges), then `fetchSourceManga(source:"0")`, `updateMangas(inLibrary)`, `fetchChapters`. Log `reader.cropping`, `reader.scans[url]` (the box in fractions and `ms`, the per-page analysis time) and the shown image's `sourceClipRect`, `sourceSize` and `hold` (`reader.shownImage()`; in the strip `itemAtIndex(0)` of the child with `cacheBuffer`). A failed analysis: right after the chapter opens, `reader.scan(reader.reader.pages[4], "file:///nonexistent/page.png")` takes that page's slot in the queue, the Canvas fails to load it, and the page shows whole (`scans[url].failed`, clip `0,0,0,0`).
- Original pages (`O`, `reader.original`, not stored): on the same margin fixture, `key("O")` sets `reader.original`, `reader.cropping` goes false and the shown image's `sourceClipRect` is `0,0,0,0` with the white margin in the capture; the bottom-left line adds "original page". A turn keeps it; `O` again brings back the clip from the kept `scans` entry. Esc and Enter on the chapter open a reader with `original` false and the clip back.
- Zoom (`reader.zoom`, `Reader.ZOOMS` 1 to 4, not stored, back to 1 as the reader opens): `+`/`-` in the paged modes, Ctrl+wheel in any mode (the strip's zoom is its width), `0` back to 1 (the strip: the default width). The spot at the middle of the view stays there (`Reader.zoomedAt`), and the page decodes at its zoomed size. A mouse drag moves the page or the strip and is no click. The indicator adds "zoom 200%". Drive with `drag(reader, x1, y1, x2, y2)` and `wheel(reader, 120, x, y, Qt.ControlModifier)`; the paged Flickable's `contentX`/`contentY` show the pan.
- Reader background (Settings row and panel row `readerTheme`, global meta `miharchy.readerTheme`): theme (the default, the Omarchy theme's background), black, gray (Mihon's `#202125`) or white. `reader.color` is it, and it shows in captures.
- Chapter transition (Mihon's `ChapterTransition`, `reader.reader.transition`): a turn past the last page (or the first) shows a page with the finished and the next chapter (or the previous and the current), "There's no next chapter" past the end, a warning when the chapter numbers skip (Mihon's `calculateChapterGap`, over the reader's list, so skipped chapters count) and one when that chapter is not downloaded while offline (`reader.offline`: no default route, checked as each chapter loads). A turn its way opens that chapter; a turn back returns to the page. Always show chapter transition (Settings and panel row, meta `miharchy.alwaysShowChapterTransition`, default on as in Mihon) off shows it only at either end, on a gap or offline. In webtoon the strip's end shows it, and scrolling up leaves it. Log `reader.reader.transition` (`dir`, `from`, `to`, `gap`, `missing`). A gap to drive: mark a middle chapter read (`updateChapter`) and turn skip read on.
- Catch-up stop (a peek only, `peek.md`): `reader.caughtUp` is the count on the stop, 0 elsewhere; `c` and `n` do nothing off it.
- Keep the screen on (Settings and panel row, meta `miharchy.keepScreenOn`, default on): shell.qml's `idleInhibitor` (Quickshell's `IdleInhibitor` on `window`) is enabled while the reader shows and the row is on, so hypridle neither dims nor locks. Offscreen there is no Wayland surface, so a drive proves only `idleInhibitor.enabled`; never run the window on the real compositor to check the lock.
- Auto-scroll (not in Mihon): `a` starts or stops it (`reader.autoSpeed`, 0 while off). In the strip a 16 ms timer moves `contentY` (1x: a view height in about 20 s) and `track()` saves the read state as for any scroll; paged, it runs Space's path every 8 s at 1x (`Reader.autoPlan`). It starts at the Settings and panel row `autoScrollSpeed` (meta `miharchy.autoScrollSpeed`, "0.5" to "3", default "1"); while it runs `+`/`-` step the speed and save it. Any other key, a click, a drag or the wheel stops it, as do the strip's end and the transition page: a paged turn off the last page always shows the transition page, so it never opens the next chapter. The indicator adds "auto 1.5x".
- `]`/`[` open the next/previous chapter where it was left; Home/End go to the first/last page; `g` opens a go-to-page field.
- The offline warning cannot be driven by changing the network; a drive sets `reader.offline = true` to show it (a simulated signal) after the pages load, since every chapter load probes the route again and overwrites it, and `tests/reader.test.js` pins the rule.
- `o` opens the chapter's page on the source's site with `xdg-open`; `y` copies its link with `wl-copy -- <url>` (the server's `ChapterType.realUrl`, carried by `Browse.toChapters` and `Reader.relist`). The bottom-left line says "Link copied", or that the server has no link. Prove it with stubs: put `xdg-open` and `wl-copy` scripts that append their arguments to a file first on `PATH` before `drive.sh`, never the real ones.
- `b` bookmarks the chapter open, or takes its bookmark off (Mihon's top bar bookmark, `Reader.bookmarkPayload`, the same `updateChapters` as `b` on the chapter list). The list carries each chapter's `bookmarked` (`reader.reader.chapters[i].bookmarked`); the bottom-left line says "bookmarked" while it is, and "Bookmark failed: ..." when the server refuses. Read back `chapter(id){ isBookmarked }`.
- `S` saves the page shown (the first of a spread, the page at the middle of the strip) to `<Save pages to>/<manga>/<manga> - <chapter> - <page>.<ext>` (Mihon's file name, `Reader.pageTarget`); the Settings row `pageFolder` (meta `miharchy.pageFolder`) is empty by default, which means `~/Pictures/Miharchy`. `Y` copies the page image with `wl-copy --type <mime>`. Both use the bytes `ServerImage` already wrote (`filePath`, `contentType`), so nothing is fetched again; the bottom-left line says "Saved to ...", "Page copied", or why not. Prove it with a scratch `HOME` and a `wl-copy` stub that records its stdin first on `PATH`, never the real clipboard or `~/Pictures`.
- Skip read, skip filtered and skip duplicate chapters (Settings rows, global meta `miharchy.skipRead`, `miharchy.skipFiltered` default on, `miharchy.skipDupe`) shape `reader.reader.chapters` as a chapter opens; the chapter opened always stays. Skip filtered uses that manga's chapter filter (manga meta `miharchy.chapterFilter*`), which the reader loads itself a moment after it opens. Set them with `setGlobalMeta`/`setMangaMeta` before the drive, then log `reader.reader.chapters` ids after a 2 s wait.
- `m` cycles the reading mode, in Mihon's order: right to left, left to right, vertical, webtoon, continuous vertical (saved per manga in meta `miharchy.readingMode`; values `paged-rtl`, `paged-ltr`, `paged-vertical`, `webtoon`, `continuous-vertical`, also the Default reading mode options). Vertical pages like left to right (`h` back, `l` on, `j`/`k` turn a page that fits) with Mihon's L click layout; continuous vertical is the webtoon strip with a 15 px gap under each page (`Reader.stripGap`, the strip's `spacing`). Everything the strip does in webtoon (`+`/`-` width, scroll, transition at its end) it does in both (`Reader.strip`, `reader.inStrip`). `f` fullscreen (real compositor only).
- `s` opens the settings panel (Mihon's reader settings sheet, `reader.panelOpen`, scope `reader-settings`): "This manga" holds the reading mode (manga meta, as `m`), "Every manga" the Settings rows in `Reader.PANEL_KEYS` (global meta, the same rows as the Settings view). `j`/`k` move, Enter or Space change a row at once, Esc, `s` or `q` close it. A skip change lists the chapters again at once (`reader.relist()`), keeping the chapter open. Rows: `reader.panelRows`, cursor `reader.panelCursor`; a row's delegate is `find(reader, function(i) { return i.modelData && i.modelData.key === "<key>" && i.current !== undefined })`.
- Download ahead while reading (Settings row `downloadAhead`, meta `miharchy.downloadAhead`: off, the default, or the next 2, 3, 5 or 10 unread chapters; Mihon's `autoDownloadWhileReading`): once the pages of a chapter load, the reader queues the next that many unread chapters in its reading order (`Reader.ahead`, skips applied) that are not on disk (`enqueueChapterDownloads`), once per chapter opened (`reader.aheadFor`). Mihon waits until the chapter open and the next are downloaded and a quarter is read; Miharchy queues as the chapter opens. Read back `downloadStatus { queue { chapter { id } } }` right after the drive: a fast source finishes and empties the queue within seconds.
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
`.claude/skills/verify-miharchy/scripts/gql.sh 'query($id:Int!){ chapter(id:$id){ lastPageRead isRead lastReadAt } }' '{"id":<chapter id>}'` → `lastPageRead` equals the logged page, `lastReadAt` set.

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
Fit and width: `reader.shown` is what the pager shows (`Reader.spread`): its `items` hold each page shown with its `x`, `width`, `height` (the size shown) and `clip`, the part of the decoded page shown (a split half, a crop; null for all of it); `reader.pageSizes` holds each image size by URL (the natural size once Crop borders reads it). The paged Flickable is the child of `reader` with `contentX` and no `cacheBuffer` (`reader.children`). Log `contentY`, `atYBeginning`, `atYEnd` around `j`/Space to show scroll-before-turn. The strip is the child with `cacheBuffer`; its `width` follows `reader.webtoonWidth`. Grab in its own step, before the next key: `grab` lands a frame later, and a fit change reloads the page.

Auto-scroll. Seed two library manga; give the first in the Library (the title sort puts it first) manga meta `miharchy.readingMode` = `webtoon` and the second `paged-ltr` with `setMangaMeta`. Webtoon: `a` at 1x, three `+` to 3x, `j` stops it, the quit saves the page:
```js
[
 [5000, function(){ log("first", root.shown.manga[0].id); key("Enter") }],
 [5000, function(){ key("Enter") }],
 [7000, function(){ root.v.s = find(reader, function(i){ return i.cacheBuffer !== undefined && i.cacheBuffer > 0 }); log("open", [reader.reader.mode, reader.reader.chapters[reader.reader.index].id, reader.reader.page, root.v.s.contentY]); key("a") }],
 [2000, function(){ log("t2", [reader.autoSpeed, root.v.s.contentY]); key("+"); key("+"); key("+") }],
 [500, function(){ log("speed", reader.autoSpeed); grab("auto-strip") }],
 [8000, function(){ log("t10", [reader.autoSpeed, root.v.s.contentY, reader.reader.page]); key("j") }],
 [300, function(){ root.v.y = root.v.s.contentY; log("stopped", reader.autoSpeed) }],
 [1500, function(){ log("still", [root.v.s.contentY - root.v.y, reader.reader.page]); root.run("window.quit") }]
]
```
Proof: `t2` shows `contentY` above `open`'s, `t10` far above at speed 3, `stopped` is 0 and `still` is 0 (no drift after the stop). Read back `manga(id){ chapters{ nodes{ id lastPageRead } } }` (the page shown) and `metas(filter:{key:{equalTo:"miharchy.autoScrollSpeed"}})`, which reads "3": the speed saves once it settles, so quick presses never leave an older one.

Paged at 3x (a turn every 2.7 s; the speed saved above), then the chapter's end. End stops it; `a` on the last page turns onto the transition page and stops there:
```js
[
 [5000, function(){ key("l"); log("cursor-manga", root.shown.manga[root.libraryCursor].id); key("Enter") }],
 [5000, function(){ key("Enter") }],
 [7000, function(){ root.v.c = reader.reader.chapters[reader.reader.index].id; log("open", [reader.reader.mode, root.v.c, reader.reader.page, reader.reader.pages.length]); key("a") }],
 [6000, function(){ log("t6", [reader.autoSpeed, reader.reader.page]); grab("auto-paged") }],
 [300, function(){ root.handleKey({ key: 0x01000011, text: "", modifiers: 0 }) }],
 [1500, function(){ log("end", [reader.autoSpeed, reader.reader.page, reader.reader.pages.length]); key("a") }],
 [4000, function(){ log("at-end", [reader.autoSpeed, reader.reader.transition !== null, reader.reader.chapters[reader.reader.index].id === root.v.c]); grab("auto-transition") }],
 [500, function(){ root.run("window.quit") }]
]
```
Proof: `t6` is `[3, 2]` (two pages in 6 s); `end` has speed 0; `at-end` is `[0, true, true]`: stopped, transition page shown, same chapter.

## Gotchas
- Suwayomi clamps `lastPageRead` to `pageCount` (-1 until pages are fetched); the reader fetches pages first.
- A chapter that is already read reopens at page 1 (Mihon's rule).
- End and a jump to the last page mark the chapter read, as a turn onto it does.
- `z` does nothing in the strip, and `+`/`-` zoom in paged but widen the strip: each changes what that mode shows.
- The default reading mode comes from meta `miharchy.defaultReadingMode`; long-strip manga open in webtoon.
