# Library

The Library view (key `1`): a cover grid of the server's library manga with unread badges, a category switcher, search, sort and filters, and removal.

## Sub-features
- Cover grid with unread-chapter badges (`unreadCount`), placeholder tiles for missing covers.
- `L` switches between the cover grid and a list (cover, title, source, unread count), as do the panel's Display rows; global meta `miharchy.libraryDisplay` keeps it. In the list, `j`/`k` move one row. A source that is not installed shows its name from meta `miharchy.sourceNames` with "(not installed)".
- The panel's Badges rows turn on a downloaded-chapters badge (top-left, before the unread count) and the source's language (top-right); its Tabs row shows each category's manga count, which a search also shows, as in Mihon. The list shows the same as text. Meta `miharchy.libraryBadgeDownloads`, `miharchy.libraryBadgeLanguage`, `miharchy.libraryTabCounts` (`on`/`off`, off by default).
- Category switcher (`Tab` / `Shift-Tab`): All, Default, then user categories.
- `/` opens the search field: title, author, artist or genre holds every typed word. `Enter` keeps the search, `Esc` in the field clears it; `Esc` on the grid clears the selection, then a kept search, and quits only when there is neither.
- `F` opens the sort and filter panel (`j`/`k` move, `Enter`/`Space` change a row, `Esc`/`F` close). Filters cycle off → include `[+]` → exclude `[-]`: downloaded, unread, started, bookmarked, completed, tracked. Sorts: title, total chapters, last read, last update, unread count, latest chapter, date added; choosing the active sort again flips ↑/↓. The header names the search, the active filters and a non-default sort.
- The sort, filters and display live in global meta `miharchy.librarySort`, `miharchy.librarySortDirection`, `miharchy.libraryDisplay` and `miharchy.libraryFilter<Name>` (`window/Prefs.js`), so a restart keeps them. The search does not persist.
- Selection, as Mihon's library selection and the Updates keys: `v` selects or deselects the manga under the cursor (a selected cover or row gets the selected background), `A` selects the whole shown category, `I` inverts, `Esc` clears. The actions take the selection, or the manga under the cursor with none, and end the selection: `R`/`U` mark every chapter read/unread (`markChapters`, so a mark read pushes the trackers), `d` queues the unread chapters not on disk, `X` twice deletes the downloads, `x` twice removes from the library (`updateMangas`), `C` opens the change categories panel. Any other key disarms `x`/`X`. The chapters come from one `chapters(filter: { mangaId: { in } })` query (`Library.chaptersPayload`).
- The change categories panel (`C`): one row per user category, `[x]` every chosen manga is in it, `[-]` some are, `[ ]` none. `Enter`/`Space` puts every chosen manga in it, or takes every one out once all are (`updateMangasCategories`); `j`/`k` move, `Esc`/`C` close and end the selection.
- `u` checks the shown category for new chapters (`updateLibrary(categories: [id])`, Default is 0; All sends none and skips excluded categories). The footer says so until the next key; the Updates view shows the run.
- `c` opens Categories: `u` there cycles a category's `includeInUpdate` UNSET, INCLUDE ("in updates"), EXCLUDE ("excluded from updates").
- `Enter` opens the manga detail (cache only).
- Settings' "Default category" row cycles Always ask, Default, then each category (meta `miharchy.defaultCategory`: `ask`, `0`, an id). `a` on a manga detail that adds the manga then moves it to exactly that category, to none for Default, or opens the detail's categories picker for Always ask (also for a deleted category; with no categories nothing asks). Drive: `key("5")`, put `root.settingsCursor` on the row, `key("Enter")` per step (wait for the save between presses: activate reads the saved value); `mangaDetail.openManga(id, false)` on a manga out of the library, `key("a")`, then log `mangaDetail.manga.categories` and `mangaDetail.picking`.
- `Space` reads the next unread chapter of the manga under the cursor without the detail, as Mihon's continue reading button: the first unread by the manga's own chapter filters and sort (`Library.continueChapter`, the detail's `Space`). A fully read manga says so in the footer; so does one whose filters hide every unread chapter. Read back: the chapter's `lastReadAt` is set.

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

Category updates: give manga 1, 2, 3 categories A, B and none (`createCategory`, `updateMangaCategories`) and set the three `exclude*` settings false. Then `key("Tab"); key("Tab"); key("u")` checks A only, and `key("c"); key("u"); key("u")` makes A EXCLUDE. A later `u` on Updates runs 2 jobs. Read back `{ categories { nodes { id includeInUpdate } } libraryUpdateStatus { jobsInfo { totalJobs } mangaUpdates { manga { id } } } }`: A is EXCLUDE, and the last run holds manga 2 and 3 only.

Selection: `key("v"); key("l"); key("v")` selects the first two covers; `key("R")` marks them read; `key("C")` then `key("Enter")` toggles the first category for them; `key("X"); key("X")` on a cover with downloads deletes them. Read back `{ mangas(filter:{id:{in:[...]}}) { nodes { id inLibrary downloadCount unreadCount categories { nodes { id } } } } downloadStatus { queue { chapter { id } } } }`.

## Gotchas
- The first manga's cover may still be loading at 4 s; grab later if covers matter. A search or filter change rebuilds the grid, so covers load again for a moment.
- The driver cannot type: set `libraryView.searchField.text` while the field is open. `key("Backtab")` sends a plain key, not Shift-Tab; use `root.run("library.previousCategory")`.
- `root.shown.manga` is the filtered, sorted category; `root.connection.manga` is the whole library.
- Covers load through `ServerImage` (files in `$XDG_RUNTIME_DIR/miharchy/images`), never URLs with credentials.
