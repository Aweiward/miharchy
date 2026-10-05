# Reader

The reader overlay: paged (RTL/LTR) or webtoon, page preload, read state saved to the server, next/previous chapter, save on quit.

## Sub-features
- `h`/`l`/arrows turn pages (direction follows the mode). `j`/`k`/`d`/`u`/Space scroll the strip in webtoon, and a paged page taller than the view (fit width, original size); at the page's edge they turn.
- `z` cycles the page fit in paged (fit screen, fit width, fit height, original size); `+`/`=`/`-` step the webtoon width (30–100 % of the window). Both are global meta (`miharchy.pageFit`, `miharchy.webtoonWidth`), also rows in Settings. The bottom-right indicator names the fit or the width.
- `]`/`[` open the next/previous chapter where it was left; Home/End go to the first/last page; `g` opens a go-to-page field.
- `m` cycles the reading mode (saved per manga in meta `miharchy.readingMode`); `f` fullscreen (real compositor only).
- Saves `lastPageRead` 1 s after the last turn; marks `isRead` on the last page; quitting flushes the pending save.

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
