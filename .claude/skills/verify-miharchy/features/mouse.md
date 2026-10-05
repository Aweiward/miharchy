# Mouse

The keyboard stays primary; the mouse reaches the same commands and never changes what a key does.

## Sub-features
- Lists and grids (Library covers, Updates, History, Browse sources, a source's covers, global search covers, Extensions, an extension's sources, a manga's chapters, Settings, Setup, Categories, Migrate, the palette, the Library and chapter sort and filter panels, the Updates filter panel, the categories picker, the Library's change categories panel, the tracking panel, a source's filters and settings, the reader's settings panel, the Sources languages panel, the download queue): a click puts the view's cursor on the item, the state j/k/h/l set. A double click puts it there and sends Enter (`Commands.enter()`) through the view's `key` signal to `root.handleKey`, so it runs what Enter runs on that screen. The download queue has no Enter: a click only moves. While a text field types, a click moves nothing, as the movement keys do.
- Library category names: a click shows that category (the state Tab sets). The view tabs (`1 Library` ...): a click presses their number.
- Hints: the status bar, the download queue, the restore and sync panels and a manga's `a add to library` draw their hint with `HintBar.qml`. A part whose first word is a key (`x remove`, `enter open`, `esc back`, `F sort & filter`, `: commands`) presses that key on a click (`Commands.hintParts`); movement parts (`j k move`, `hjkl move`) and counts (`3 selected`) are plain text. The status bar's hint (`hintBar`) wraps past the space beside the connection state (`connectionText`), and the bar grows up: on a manga's page at 1280 px it takes two lines. Measure each part with `p.mapToItem(status, 0, 0)` over `hintBar.children` that have a `modelData`. An offscreen window does not resize; narrow the bar with `status.anchors.rightMargin` instead. A source's `p popular   n latest   / search   F filter` labels press their key too.
- Panels and overlays take the clicks over them: a click outside an open panel never reaches the item under it, where a double click's Enter would act on the panel. A click outside the palette closes it (Esc).
- Reader (Mihon's default navigation, `Reader.tapZone`): right to left and left to right, the left third runs `reader.left` and the right third `reader.right`, so the turn follows the reading direction as h and l do; the middle does nothing (Mihon's menu; Miharchy has none). Vertical and the strip (Mihon's L layout): the top third and the left of the middle run `reader.halfUp`, the bottom third and the right of the middle `reader.halfDown`. Each click of a quick pair turns. On the chapter transition page the same zones turn: the reading-on zone opens that chapter, the other returns to the page. The wheel runs `reader.down`/`reader.up` per notch in paged mode (`Reader.wheel` adds touchpad deltas up), so a tall page scrolls before it turns; in webtoon it scrolls the strip, and the page under the middle of the view is saved as for any scroll.
- The wheel scrolls every ListView and GridView (Qt's own flicking). A source's grid keeps its place when a page more loads (`Browse.continues`), so the wheel can scroll past the first page.

## How to get to it (user POV)
Any view; the reader opens on a chapter's double click.

## Driving it with drive.sh
Click a cover, double click it, then a chapter, then the reader's zones in both directions, then the wheel:
```js
[
  [6000, function() { click(find(libraryView, function(i) { return i.modelData && i.index === 2 && i.current !== undefined })) }],
  [300, function() { log("cover click", root.libraryCursor); dblclick(find(libraryView, function(i) { return i.modelData && i.index === 2 && i.current !== undefined })) }],
  [6000, function() { log("detail", mangaDetail.open); dblclick(find(mangaDetail, function(i) { return i.modelData && i.index === 0 && i.inRange !== undefined })) }],
  [8000, function() { log("reader", [reader.open, reader.reader.mode, reader.reader.page]); click(reader, reader.width * 0.1, reader.height / 2) }],
  [1000, function() { log("left third", reader.reader.page); key("m") }],
  [500, function() { log("mode", reader.reader.mode); click(reader, reader.width * 0.9, reader.height / 2) }],
  [1000, function() { log("right third", reader.reader.page); wheel(reader, -120) }],
  [1000, function() { log("wheel down", reader.reader.page); key("m"); key("m") }],
  [4000, function() { root.v.strip = find(reader, function(i) { return i.pinToEnd !== undefined }); log("webtoon", root.v.strip.contentY); wheel(root.v.strip, -600) }],
  [1500, function() { log("strip after wheel", [root.v.strip.contentY, reader.reader.page]); root.run("window.quit") }]
]
```
In `paged-rtl` the left third reads on (page + 1); in `paged-ltr` the right third does. Read back the chapter's `lastPageRead` after the quit: it equals the last logged page. A list's wheel: `find` the ListView (`i.orientation !== undefined && i.count > 20`), `wheel(list, -600)`, log `contentY` 1.5 s later.

## Gotchas
- `grab()` captures after the step returns: end the step with it.
- The seeded library's manga have three or four chapters, too few to scroll; scroll Extensions (`Tab` on Browse, hundreds of rows), a source's grid, or Updates after the updates seed in `updates.md`.
- Webtoon wheel scrolling is Qt's: about 40 px a notch.
- A vertical wheel over global search's horizontal cover strips falls through to the list of sources (Qt 6.11, checked in a standalone ListView-in-ListView). With one source installed the list does not overflow, so install more before you prove that scroll in the window.
