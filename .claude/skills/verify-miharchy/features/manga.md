# Manga chapter actions

The manga detail's chapter list: mark read or unread, bookmark, mark every earlier chapter read, filter and sort the list, resume, download and delete downloads, on the cursor or a `v` selection.

## Sub-features
- `R` marks the chapter under the cursor, or the `v` selection, read. Only unread chapters change; `lastPageRead` stays.
- `u` marks them unread. A chapter with a page read also goes back to `lastPageRead` 0 (Mihon's `SetReadStatus`).
- `b` bookmarks them, or removes the bookmark when every one has it (Mihon's bottom menu). A bookmarked chapter shows `★` and the accent color.
- `P` marks every chapter before the cursor in reading order read, among the chapters shown, without the one under it (Mihon's `markPreviousChapterRead`): below the cursor when the list is descending, above it when ascending. A chapter the filter hides stays as it is.
- `F` opens the filter and sort panel. Filters: unread, downloaded, bookmarked, each off, include or exclude. Sorts: by source, chapter number, upload date. Choosing the current sort flips its direction; a new sort starts ascending (Mihon's `SetMangaChapterFlags`). Descending is newest first; source order breaks ties.
- The `F` panel also lists the manga's scanlators (A to Z, ignoring case) between the filters and the sorts. Enter on one excludes it (`[-]`) or lets it back (`[ ]`), saved at once to manga meta `miharchy.excludedScanlators` as a JSON list (Mihon's `ScanlatorFilterDialog`). An excluded scanlator's chapters leave the list, the next-chapter pick, and the reader's chapter list even with skip filtered off; the chapter opened stays. Save as default never touches them. The panel scrolls when the rows run past the window.
- The choices are per manga: manga meta `miharchy.chapterFilterUnread`, `chapterFilterDownloaded`, `chapterFilterBookmarked`, `chapterSort`, `chapterSortDirection`. The same keys in global meta are the default. "Save as default" writes the current five to global meta; "for every manga in the library" also drops those keys from every library manga (`deleteMangaMetas`), so they follow the default.
- The header shows the chapter count, how many the filter hides, and `Start: space` or `Resume chapter N: space`. Space opens the first unread chapter in reading order among those shown (Mihon's `getNextUnread`); the reader opens it at its `lastPageRead`.
- The reader gets the chapters in the manga's chosen sort, read ascending, like Mihon's `ReaderViewModel` (`getChapterSort(manga, sortDescending = false)`), minus what the skip settings drop (`Chapters.readingOrder`, see `reader.md`). Proof: set `miharchy.chapterSort` to `uploadDate` with `setMangaMeta`, open a chapter from the detail, wait 2 s, and log `reader.reader.chapters` ids: they follow upload date, oldest first.
- A mark read sends `trackProgress` for the manga after the mark succeeds.
- Every mark and bookmark goes through `shell.qml` `markChapters(chapters, action)` (`window/Chapters.js` builds the payloads), which reloads the detail, Updates and the Library (its unread badge and bookmarked filter).
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

Bookmark, filter, sort and resume. The panel rows run unread, downloaded, bookmarked, by source, by number, by upload date, save as default, save as default for every manga. Indexes of `mangaDetail.shown` are what the cursor sees; `mangaDetail.optionRows` shows the choices:
```js
[
  [5000, function() { key("Enter") }],
  [4000, function() { log("resume", mangaDetail.resume); key("j"); key("b") }],
  [3000, function() { log("bookmarks", mangaDetail.detail.chapters.map(function(c) { return [c.id, c.bookmarked] })); key("F"); key("Enter") }],
  [1500, function() { log("unread-only", mangaDetail.shown.map(function(c) { return c.id })); grab("filter"); key("Enter"); key("Enter"); key("j"); key("j"); key("j"); key("j"); key("j"); key("Enter") }],
  [1500, function() { log("by-date-asc", mangaDetail.shown.map(function(c) { return c.id })); key("j"); key("Enter") }],
  [2500, function() { key("Esc"); key(" ") }],
  [5000, function() { log("reader", [reader.reader.chapters[reader.reader.index].id, reader.reader.page]); key("Esc") }],
  [1500, function() { done() }]
]
```
Read back: `$S/gql.sh '{ manga(id:<id>){ meta { key value } chapters { nodes { id isBookmarked isRead } } } metas(filter:{key:{startsWith:"miharchy.chapter"}}){ nodes { key value } } }'`. Run the window a second time to see the choices come back from meta.

## Gotchas
- `grab()` saves asynchronously; a `done()` in the same step quits before the file is written.
- `updateChapters` stamps `lastReadAt` whenever the patch carries `lastPageRead`, which puts the chapter in History. So `u` resets only chapters with a page read; a mark read never sends `lastPageRead`.
- Suwayomi clamps `lastPageRead` to `pageCount`, which is -1 until the pages are fetched.
- A scratch server has no tracker logged in, so `trackProgress` answers with no records; prove the push with the document's reply, not a tracker.
- The seeded MangaDex manga have three chapters each, and one of them numbers all three 1. Upload dates there run out of source order, which is what proves the date sort.
- A `grab()` followed in the same step by keys that open another manga captures the next screen, not this one.
- The chapter choices load after the detail opens, so a capture right after `Enter` can show the default order for a moment.
