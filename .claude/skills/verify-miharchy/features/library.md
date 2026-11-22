# Library

The Library view (key `1`): a cover grid of the server's library manga with unread badges, a category switcher, search, sort and filters, and removal.

## Sub-features
- Downloaded only (palette "Downloaded only on or off", `root.run("mode.downloadedOnly")`, meta `miharchy.downloadedOnly`): the Library shows only manga with downloads (`libraryView.shown.manga`), a manga's chapter list only downloaded chapters (`mangaDetail.shown`), the reader's list only those plus the one opened (`reader.reader.chapters`), Updates only downloaded rows (it forces `updatesFilterDownloaded`, which the Updates panel shows as `[+]`); the status bar says "downloaded only". Seed a download with `core.sh api download.enqueue '{"ids":[<chapter>]}'` (it starts the downloader) and poll `chapter.list` until its `isDownloaded` is true. The stored filters stay as they were (read back `meta.get`).
- Cover grid with unread-chapter badges (`unreadCount`), placeholder tiles for missing covers.
- `L` switches between the cover grid and a list (cover, title, source, unread count), as do the panel's Display rows; global meta `miharchy.libraryDisplay` keeps it. In the list, `j`/`k` move one row. A source that is not installed shows its name from meta `miharchy.sourceNames` with "(not installed)".
- The panel's Badges rows turn on a downloaded-chapters badge (top-left, before the unread count) and the source's language (top-right); its Tabs row shows each category's manga count, which a search also shows, as in Mihon. The list shows the same as text. Meta `miharchy.libraryBadgeDownloads`, `miharchy.libraryBadgeLanguage`, `miharchy.libraryTabCounts` (`on`/`off`, off by default).
- Category switcher (`Tab` / `Shift-Tab`): All, Default, then user categories.
- `/` opens the search field: title, author, artist or genre holds every typed word. `Enter` keeps the search, `Esc` in the field clears it; `Esc` on the grid clears the selection, then a kept search, and quits only when there is neither.
- `F` opens the sort and filter panel (`j`/`k` move, `Enter`/`Space` change a row, `Esc`/`F` close). Filters cycle off → include `[+]` → exclude `[-]`: downloaded, unread, started, bookmarked, completed, tracked. Sorts: title, total chapters, last read, last update, unread count, latest chapter, date added; choosing the active sort again flips ↑/↓. The header names the search, the active filters and a non-default sort.
- The sort, filters and display live in global meta `miharchy.librarySort`, `miharchy.librarySortDirection`, `miharchy.libraryDisplay` and `miharchy.libraryFilter<Name>` (`Library.PREFS`, stored through `window/Prefs.js`), so a restart keeps them. The search does not persist.
- Selection, as Mihon's library selection and the Updates keys: `v` selects or deselects the manga under the cursor (a selected cover or row gets the selected background), `A` selects the whole shown category, `I` inverts, `Esc` clears. The actions take the selection, or the manga under the cursor with none, and end the selection: `R`/`U` mark every chapter read/unread (`markChapters`, so a mark read pushes the trackers as `miharchy.trackOnMarkRead` says, see `trackers.md`), `X` twice deletes the downloads, `x` twice removes from the library (`manga.update` with `inLibrary` false) and keeps the downloads, `x` then `d` also deletes them first (Mihon's remove dialog; `Esc` or any other key keeps the manga, and only disarms), `C` opens the change categories panel. Any other key disarms `x`/`X`. The chapters come from one `chapter.list` with `mangaIds` (`Library.chaptersPayload`).
- `d` opens the download menu for the selection, or with none for the whole shown category tab (not the manga under the cursor), and ends the selection: next chapters of a set of manga, see `downloads.md`.
- The change categories panel (`C`): one row per user category, `[x]` every chosen manga is in it, `[-]` some are, `[ ]` none. `Enter`/`Space` puts every chosen manga in it, or takes every one out once all are (`manga.update` with `addToCategories` or `removeFromCategories`); `j`/`k` move, `Esc`/`C` close and end the selection.
- `u` checks the shown category for new chapters (`update.start` with `categories: [id]`, Default is 0; All sends none and skips excluded categories). The footer says so until the next key; the Updates view shows the run.
- `c` opens Categories: `u` there cycles a category's `includeInUpdate` UNSET, INCLUDE ("in updates"), EXCLUDE ("excluded from updates").
- `Enter` opens the manga detail (cache only).
- Settings' "Default category" row cycles Always ask, Default, then each category (meta `miharchy.defaultCategory`: `ask`, `0`, an id). `a` on a manga detail that adds the manga then moves it to exactly that category, to none for Default, or opens the detail's categories picker for Always ask (also for a deleted category; with no categories nothing asks). Drive: `key("5")`, put `root.settingsCursor` on the row, `key("Enter")` per step (wait for the save between presses: activate reads the saved value); `mangaDetail.openManga(id, false)` on a manga out of the library, `key("a")`, then log `mangaDetail.manga.categories` and `mangaDetail.picking`.
- `Space` reads the next unread chapter of the manga under the cursor without the detail, as Mihon's continue reading button: the first unread by the manga's own chapter filters and sort (`Library.continueChapter`, the detail's `Space`). A fully read manga says so in the footer; so does one whose filters hide every unread chapter. Read back: the chapter's `lastReadAt` is set.

## How to get to it (user POV)
Open the window; it starts on Library. Or press `1`.

## Seeding varied state
After `core.sh seed`, put five manga in the library: `source.popular '{"source":"<MangaDex (EN) id>","page":1}'`, `manga.update '{"ids":[<5 ids>],"inLibrary":true}'`, then `manga.refresh '{"id":<id>}'` on each. They are all unread; their status is whatever MangaDex reports. Then:
- read: `chapter.update '{"ids":[...],"isRead":true}'` on all of one manga's chapters (unread 0, started) and one chapter of another (started, unread).
- bookmarked: the same with `"isBookmarked":true`.
- downloaded: `download.enqueue '{"ids":[...]}'`, then poll `library.list` until the manga's `downloadCount` counts them.
- completed: core has no status route, so add a manga the source reports `COMPLETED`. MangaDex maps its "completed" to `PUBLISHING_FINISHED` unless the last chapter is present; a oneshot comes back `COMPLETED` (`source.search` with `"query":"oneshot"`, then `manga.refresh`, and check `status` in `library.list`).
- tracked: a track record written into `core.db` (SKILL.md, miharchy-core) gives `trackCount` 1 in `library.list`.

## Driving it with drive.sh
```js
[
  [7000, function() { log("library", libraryView.shown.manga.map(function(m) { return [m.id, m.unread] })); grab("library") }],
  [300, function() { key("/") }],
  [300, function() { libraryView.searchField.text = "romance"; log("search", libraryView.shown.manga.map(function(m) { return m.id })) }],
  [300, function() { key("Enter"); key("Esc"); log("cleared", libraryView.query) }],
  [300, function() { key("F"); key("j"); key("Enter"); log("unread-include", libraryView.shown.manga.map(function(m) { return m.id })) }],
  [300, function() { key("Esc"); grab("filtered") }],
  [200, function() { key("x") }],
  [200, function() { key("x") }],
  [3000, function() { log("after-remove", root.connection.manga.length); grab("library-removed"); root.run("window.quit") }]
]
```
Read back: `core.sh api meta.get '{"scope":"global"}' | jq -c '[.metas[] | select(.key | startswith("miharchy.library")) | {key, value}]'` shows the saved choices, and `core.sh api library.list '{}' | jq -c '[.mangas[] | .title]'` one fewer manga; the removed manga's chapters keep their `isRead` (`chapter.list '{"mangaIds":[<id>]}'`). Then a second `drive.sh` run that only logs `libraryView.prefs` and grabs proves a restart keeps them.

Category updates: give three library manga categories A, B and none (`category.create '{"name":"A"}'`, `manga.update '{"ids":[<id>],"addToCategories":[<A>]}'`) and set the three skip filters off (`settings.set '{"settings":{"excludeUnreadChapters":false,"excludeNotStarted":false,"excludeCompleted":false}}'`). Then `key("Tab"); key("Tab"); key("u")` checks A only, and `key("c"); key("u"); key("u")` makes A EXCLUDE. A later `u` on Updates runs 2 jobs. Read back `core.sh api category.list '{}' | jq -c '[.categories[] | {id, name, includeInUpdate}]'` (A is EXCLUDE) and `core.sh api update.status '{}' | jq -c '{totalJobs, finishedJobs, skippedMangasCount}'` (2 jobs). Core's status names no manga, so which manga ran shows only as their `chaptersLastFetchedAt` in `library.list`.

Selection: `key("v"); key("l"); key("v")` selects the first two covers; `key("R")` marks them read and ends the selection, so select them again before `key("C")`; then `key("Enter")` toggles the first category for them; `key("X"); key("X")` on a cover with downloads deletes them. Read back `core.sh api library.list '{}' | jq -c '[.mangas[] | {id, downloadCount, unreadCount, categories}]'` (a removed manga is missing) and `core.sh api download.queue '{}' | jq -c '[.queue[].chapter.id]'`.

## Gotchas
- The first manga's cover may still be loading at 4 s; grab later if covers matter. A change keeps the cells of the manga that stay (`RowModel.qml`); a manga coming into view gets a new cell, whose cover comes from `Images.js` without a request but may decode for a moment. To count rebuilt cells, keep the grid's delegates (`contentItem.children` with a `chosen` property) before a change and compare them by identity after it. A sort that moves most manga resets the grid (`Model.listChanges`).
- The driver cannot type: set `libraryView.searchField.text` while the field is open. `key("Backtab")` sends a plain key, not Shift-Tab; use `root.run("library.previousCategory")`.
- `libraryView.shown.manga` is the filtered, sorted category; `root.connection.manga` is the whole library.
- Covers load through `ServerImage` (files in `$XDG_RUNTIME_DIR/miharchy/images`), never URLs with credentials. `drive.sh` runs the window with `XDG_RUNTIME_DIR=$RUN/runtime`, so a drive's files land in `$RUN/runtime/miharchy/images`, out of the real one, where they can be measured. To count requests, use the logging proxy pattern from SKILL.md's Live updates section; `done()` skips the window's quit path, so end with `root.run("window.quit")` when the files left after exit matter.
