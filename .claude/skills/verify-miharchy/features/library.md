# Library

The Library view (key `1`): a cover grid of the server's library manga with unread badges, a category switcher, search, sort and filters, and removal.

## Sub-features
- Cover grid with unread-chapter badges (`unreadCount`), placeholder tiles for missing covers.
- Category switcher (`Tab` / `Shift-Tab`): All, Default, then user categories.
- `/` opens the search field: title, author, artist or genre holds every typed word. `Enter` keeps the search, `Esc` in the field clears it; `Esc` on the grid clears a kept search, and quits only when there is none.
- `F` opens the sort and filter panel (`j`/`k` move, `Enter`/`Space` change a row, `Esc`/`F` close). Filters cycle off → include `[+]` → exclude `[-]`: downloaded, unread, started, bookmarked, completed, tracked. Sorts: title, total chapters, last read, last update, unread count, latest chapter, date added; choosing the active sort again flips ↑/↓. The header names the search, the active filters and a non-default sort.
- The sort and filters live in global meta `miharchy.librarySort`, `miharchy.librarySortDirection` and `miharchy.libraryFilter<Name>` (`window/Prefs.js`), so a restart keeps them. The search does not persist.
- `x` twice removes the manga under the cursor from the library; any other key disarms.
- `Enter` opens the manga detail (cache only).

## How to get to it (user POV)
Open the window; it starts on Library. Or press `1`.

## Seeding varied state
`seed.sh --library 5` gives five ONGOING MangaDex manga, all unread. Then, by GraphQL:
- read: `updateChapters(input:{ids:[...], patch:{isRead:true}})` on all of one manga's chapters (unread 0, started) and one chapter of another (started, unread).
- bookmarked: the same with `patch:{isBookmarked:true}`.
- downloaded: `enqueueChapterDownloads(input:{ids:[...]})`, `startDownloader(input:{})`, then poll `manga(id){ downloadCount }`.
- completed: the server has no status mutation, so add a manga the source reports `COMPLETED`. MangaDex maps its "completed" to `PUBLISHING_FINISHED` unless the last chapter is present; a oneshot comes back `COMPLETED` (`fetchSourceManga(type: SEARCH, query: "oneshot")`, then `fetchMangaAndChapters` and check `status`).
- tracked: needs a tracker login, so it is proven by `window/tests/library.test.js` only.

## Driving it with drive.sh
```js
[
  [7000, function() { log("library", root.shown.manga.map(function(m) { return [m.id, m.unread] })); grab("library") }],
  [300, function() { key("/") }],
  [300, function() { libraryView.searchField.text = "romance"; log("search", root.shown.manga.map(function(m) { return m.id })) }],
  [300, function() { key("Enter"); key("Esc"); log("cleared", root.libraryQuery) }],
  [300, function() { key("F"); key("j"); key("Enter"); log("unread-include", root.shown.manga.map(function(m) { return m.id })) }],
  [300, function() { key("Esc"); grab("filtered") }],
  [200, function() { key("x") }],
  [200, function() { key("x") }],
  [3000, function() { log("after-remove", root.connection.manga.length); grab("library-removed"); root.run("window.quit") }]
]
```
Read back: `$S/gql.sh '{ metas(filter:{key:{startsWith:"miharchy.library"}}) { nodes { key value } } mangas(condition:{inLibrary:true}){ totalCount nodes { title } } }'` shows the saved choices and one fewer manga; its chapters' `isRead` unchanged. Then a second `drive.sh` run that only logs `root.libraryPrefs` and grabs proves a restart keeps them.

## Gotchas
- The first manga's cover may still be loading at 4 s; grab later if covers matter. A search or filter change rebuilds the grid, so covers load again for a moment.
- The driver cannot type: set `libraryView.searchField.text` while the field is open. `key("Backtab")` sends a plain key, not Shift-Tab; use `root.run("library.previousCategory")`.
- `root.shown.manga` is the filtered, sorted category; `root.connection.manga` is the whole library.
- Covers load through `ServerImage` (files in `$XDG_RUNTIME_DIR/miharchy/images`), never URLs with credentials.
