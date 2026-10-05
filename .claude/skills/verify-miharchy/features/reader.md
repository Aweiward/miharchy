# Reader

The reader overlay: paged (RTL/LTR) or webtoon, page preload, read state saved to the server, next/previous chapter, save on quit.

## Sub-features
- `h`/`l`/arrows/Space turn pages (direction follows the mode); `j`/`k`/`d`/`u` scroll in webtoon.
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

## Gotchas
- Suwayomi clamps `lastPageRead` to `pageCount` (-1 until pages are fetched); the reader fetches pages first.
- A chapter that is already read reopens at page 1 (Mihon's rule).
- The default reading mode comes from meta `miharchy.defaultReadingMode`; long-strip manga open in webtoon.
