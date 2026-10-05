# Manga chapter actions

The manga detail's chapter list: mark read or unread, mark every chapter below the cursor read, download and delete downloads, on the cursor or a `v` selection.

## Sub-features
- `R` marks the chapter under the cursor, or the `v` selection, read. Only unread chapters change; `lastPageRead` stays.
- `u` marks them unread. A chapter with a page read also goes back to `lastPageRead` 0 (Mihon's `SetReadStatus`).
- `P` marks every chapter below the cursor read, without the one under it (Mihon's "mark previous as read").
- A mark read sends `trackProgress` for the manga after the mark succeeds.
- Every mark goes through `shell.qml` `markChapters()` (`window/Chapters.js` builds the payloads), which reloads the detail, Updates and the Library (its unread badge).
- `d` / `x` / `U` download, delete, download unread (`window/Downloads.js`).

## How to get to it (user POV)
Library → `Enter` on a manga.

## Driving it with drive.sh
Give one chapter a page read first, so `u` has a reset to do (the page count exists only after the pages are fetched):
```sh
$S/gql.sh 'mutation($id:Int!){ fetchChapterPages(input:{chapterId:$id}){ pages } }' '{"id":<2nd chapter id>}' >/dev/null
$S/gql.sh 'mutation($id:Int!){ updateChapter(input:{id:$id, patch:{lastPageRead:3}}){ chapter{ lastPageRead } } }' '{"id":<2nd chapter id>}'
```
```js
[
  [5000, function() { key("Enter") }],
  [4000, function() { log("before", mangaDetail.detail.chapters.slice(0, 4)); log("badge", root.connection.manga.filter(function(m) { return m.id === mangaDetail.detail.mangaId })[0].unread); key("R") }],
  [3000, function() { log("after-R", mangaDetail.detail.chapters[0].read); key("j"); key("j"); key("P") }],
  [3000, function() { log("badge-after-P", root.connection.manga.filter(function(m) { return m.id === mangaDetail.detail.mangaId })[0].unread); key("k"); key("v"); key("k"); key("u") }],
  [3000, function() { log("after-u", mangaDetail.detail.chapters.slice(0, 4)); grab("manga-marked") }],
  [500,  function() { done() }]
]
```
Read back: `$S/gql.sh 'query($id:Int!){ manga(id:$id){ unreadCount chapters{ nodes{ id isRead lastPageRead lastReadAt sourceOrder } } } }' '{"id":<manga id>}'`.

## Gotchas
- `grab()` saves asynchronously; a `done()` in the same step quits before the file is written.
- `updateChapters` stamps `lastReadAt` whenever the patch carries `lastPageRead`, which puts the chapter in History. So `u` resets only chapters with a page read; a mark read never sends `lastPageRead`.
- Suwayomi clamps `lastPageRead` to `pageCount`, which is -1 until the pages are fetched.
- A scratch server has no tracker logged in, so `trackProgress` answers with no records; prove the push with the document's reply, not a tracker.
